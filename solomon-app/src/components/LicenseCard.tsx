import { StyleSheet, Text, View } from "react-native";
import { theme } from "@/theme";
import type { LicenseSummary } from "@/data/license";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

export function LicenseCard({ license }: { license: LicenseSummary }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View>
          <Text style={styles.clientName}>{license.clientName}</Text>
          <Text style={styles.agreementNumber}>Agreement {license.agreementNumber}</Text>
        </View>
        <View style={styles.statusPill}>
          <Text style={styles.statusText}>{license.status}</Text>
        </View>
      </View>

      <View style={styles.divider} />

      <Row label="Data tier" value={license.dataTier.name} />
      <Row label="Access level" value={license.dataTier.accessLevel} />
      <Row label="Base licensing fee" value={license.baseFee} />
      <Row label="Usage royalty" value={license.royalty} />
      <Row label="Effective date" value={license.effectiveDate} />
      <Row label="Renewal date" value={license.renewalDate} />
      <Row label="Rate fixed for" value={`${license.continuousQuoteFixedYears} years (Continuous Quote)`} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.parchmentCard,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.line,
    padding: theme.spacing(5),
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  clientName: {
    fontSize: 20,
    fontWeight: "600",
    color: theme.colors.ink,
  },
  agreementNumber: {
    fontSize: 13,
    color: theme.colors.muted,
    marginTop: 2,
  },
  statusPill: {
    backgroundColor: theme.colors.goodBg,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  statusText: {
    color: theme.colors.good,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  divider: {
    height: 1,
    backgroundColor: theme.colors.line,
    marginVertical: theme.spacing(4),
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingVertical: theme.spacing(2),
    gap: theme.spacing(3),
  },
  rowLabel: {
    fontSize: 13,
    color: theme.colors.muted,
    flexShrink: 0,
  },
  rowValue: {
    fontSize: 14,
    color: theme.colors.ink,
    fontWeight: "500",
    textAlign: "right",
    flex: 1,
  },
});
