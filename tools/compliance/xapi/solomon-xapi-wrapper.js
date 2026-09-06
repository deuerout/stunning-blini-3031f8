/**
 * SolomonXAPIWrapper -- lightweight vanilla JS xAPI client for the Solomon
 * Licensing Training Module, fired to a standard LRS endpoint over Basic Auth.
 *
 * PII / masking design (per the Phase 1 compliance audit):
 *   - The actor is ALWAYS an opaque internal learner ID via the xAPI
 *     `account` identifier ({homePage, name}), never a raw email or name.
 *     The LRS never receives anything that identifies a person outside the
 *     platform's own user table.
 *   - `result.response` only ever carries an enumerable choice ID (e.g.
 *     "b" for a multiple-choice answer), never free text.
 *   - `context.extensions` only carries enumerable values (module ID,
 *     attempt number, numeric score) -- never narrative text.
 *   - There is no method on this class that accepts a free-text field and
 *     forwards it to the LRS. That's deliberate: if a future statement type
 *     needs free text, it needs a new masking decision, not a shortcut
 *     through an existing method's options bag.
 *
 * Works unmodified in a browser (inject via <script>) or Node 18+ (uses the
 * global `fetch` and `crypto.randomUUID`, both available in modern
 * browsers and Node without any dependency).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.SolomonXAPIWrapper = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var VERBS = {
    registered: { id: "http://adlnet.gov/expapi/verbs/registered", display: { "en-US": "registered" } },
    experienced: { id: "http://adlnet.gov/expapi/verbs/experienced", display: { "en-US": "experienced" } },
    responded: { id: "http://adlnet.gov/expapi/verbs/responded", display: { "en-US": "responded" } },
    passed: { id: "http://adlnet.gov/expapi/verbs/passed", display: { "en-US": "passed" } },
  };

  var ACTIVITY_TYPE_MODULE = "http://adlnet.gov/expapi/activities/module";
  var ACTIVITY_TYPE_QUESTION = "http://adlnet.gov/expapi/activities/cmi.interaction";
  var ACTIVITY_TYPE_COURSE = "http://adlnet.gov/expapi/activities/course";

  function b64encode(str) {
    if (typeof btoa === "function") return btoa(str);
    return Buffer.from(str, "utf-8").toString("base64"); // Node fallback
  }

  function uuid() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    // RFC4122-ish fallback for older runtimes without crypto.randomUUID.
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  /**
   * @param {Object} opts
   * @param {string} opts.endpoint     LRS statements endpoint, e.g. "https://lrs.example.com/xapi/statements"
   * @param {string} opts.authKey      LRS Basic Auth key (client, not learner credential)
   * @param {string} opts.authSecret   LRS Basic Auth secret
   * @param {string} opts.learnerId    Opaque internal learner/user ID -- NOT an email or real name
   * @param {string} [opts.homePage]   IRI identifying the account namespace (default: "https://deuerout.com/solomon/xapi/users")
   * @param {number} [opts.maxRetries] Retries on network error / 5xx (default 3)
   * @param {number} [opts.retryBaseMs] Base backoff delay in ms (default 500, doubles each retry)
   * @param {function} [opts.fetchImpl] Injectable fetch implementation, for testing
   */
  function SolomonXAPIWrapper(opts) {
    opts = opts || {};
    if (!opts.endpoint) throw new Error("SolomonXAPIWrapper: 'endpoint' is required");
    if (!opts.authKey || !opts.authSecret) throw new Error("SolomonXAPIWrapper: 'authKey' and 'authSecret' are required");
    if (!opts.learnerId) throw new Error("SolomonXAPIWrapper: 'learnerId' is required");

    this.endpoint = opts.endpoint.replace(/\/+$/, "");
    this.authHeader = "Basic " + b64encode(opts.authKey + ":" + opts.authSecret);
    this.actor = {
      objectType: "Agent",
      account: {
        homePage: opts.homePage || "https://deuerout.com/solomon/xapi/users",
        name: String(opts.learnerId),
      },
    };
    this.maxRetries = typeof opts.maxRetries === "number" ? opts.maxRetries : 3;
    this.retryBaseMs = typeof opts.retryBaseMs === "number" ? opts.retryBaseMs : 500;
    this._fetch = opts.fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
    if (!this._fetch) {
      throw new Error("SolomonXAPIWrapper: no fetch implementation available; pass opts.fetchImpl");
    }
  }

  SolomonXAPIWrapper.prototype._activity = function (type, id, name) {
    return {
      objectType: "Activity",
      id: id,
      definition: {
        type: type,
        name: { "en-US": name },
      },
    };
  };

  /**
   * POSTs a single xAPI statement, retrying on network failure or 5xx with
   * exponential backoff. Does NOT retry on 4xx -- a bad statement or bad
   * auth will not become valid by resending it unchanged, and hammering
   * the LRS with the same rejected payload is its own kind of abuse.
   */
  SolomonXAPIWrapper.prototype._send = function (statement) {
    var self = this;
    statement.id = statement.id || uuid();
    statement.timestamp = statement.timestamp || new Date().toISOString();

    var attempt = 0;

    function attemptSend() {
      return self
        ._fetch(self.endpoint + "/statements", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: self.authHeader,
            "X-Experience-API-Version": "1.0.3",
          },
          body: JSON.stringify(statement),
        })
        .then(function (res) {
          if (res.ok) {
            return { ok: true, status: res.status, statementId: statement.id };
          }
          if (res.status >= 400 && res.status < 500) {
            return res.text().then(function (body) {
              var err = new Error(
                "SolomonXAPIWrapper: LRS rejected statement (HTTP " + res.status + "): " + body
              );
              err.status = res.status;
              err.retryable = false;
              throw err;
            });
          }
          // 5xx: retryable.
          var err = new Error("SolomonXAPIWrapper: LRS returned HTTP " + res.status);
          err.status = res.status;
          err.retryable = true;
          throw err;
        })
        .catch(function (err) {
          if (err && err.retryable === false) throw err;
          attempt += 1;
          if (attempt > self.maxRetries) {
            err.message = "SolomonXAPIWrapper: giving up after " + attempt + " attempt(s): " + err.message;
            throw err;
          }
          var delay = self.retryBaseMs * Math.pow(2, attempt - 1);
          return sleep(delay).then(attemptSend);
        });
    }

    return attemptSend();
  };

  /** Verb: registered -- learner enrolled in the training module. */
  SolomonXAPIWrapper.prototype.registerLearner = function (moduleId, moduleName) {
    return this._send({
      actor: this.actor,
      verb: VERBS.registered,
      object: this._activity(ACTIVITY_TYPE_COURSE, moduleId, moduleName),
    });
  };

  /** Verb: experienced -- learner viewed a panel/section of the module. */
  SolomonXAPIWrapper.prototype.sectionExperienced = function (sectionId, sectionName, attemptNumber) {
    return this._send({
      actor: this.actor,
      verb: VERBS.experienced,
      object: this._activity(ACTIVITY_TYPE_MODULE, sectionId, sectionName),
      context: {
        extensions: {
          "https://deuerout.com/solomon/xapi/extensions/attempt": attemptNumber || 1,
        },
      },
    });
  };

  /**
   * Verb: responded -- learner answered a mini-check question.
   * `choiceId` and `correct` are enumerable/boolean only -- never the
   * learner's typed text, per the no-free-text masking rule.
   */
  SolomonXAPIWrapper.prototype.miniCheckResponded = function (questionId, questionName, choiceId, correct) {
    return this._send({
      actor: this.actor,
      verb: VERBS.responded,
      object: this._activity(ACTIVITY_TYPE_QUESTION, questionId, questionName),
      result: {
        success: !!correct,
        response: String(choiceId),
      },
    });
  };

  /** Verb: passed -- learner completed the module with a numeric score. */
  SolomonXAPIWrapper.prototype.modulePassed = function (moduleId, moduleName, scaledScore) {
    if (typeof scaledScore !== "number" || scaledScore < 0 || scaledScore > 1) {
      throw new Error("SolomonXAPIWrapper.modulePassed: scaledScore must be a number in [0,1]");
    }
    return this._send({
      actor: this.actor,
      verb: VERBS.passed,
      object: this._activity(ACTIVITY_TYPE_COURSE, moduleId, moduleName),
      result: {
        success: true,
        completion: true,
        score: { scaled: scaledScore },
      },
    });
  };

  SolomonXAPIWrapper.VERBS = VERBS;
  return SolomonXAPIWrapper;
});
