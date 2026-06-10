// Deverout and Associates — shared site behaviour
(function(){
  var hdr = document.getElementById('hdr');
  if (hdr && !hdr.classList.contains('solid')) {
    addEventListener('scroll', function(){ hdr.classList.toggle('scrolled', scrollY > 40); });
  }
  var nav = document.getElementById('nav'), btn = document.getElementById('navbtn');
  if (btn && nav) {
    btn.addEventListener('click', function(){ nav.classList.toggle('open'); });
    nav.querySelectorAll('a').forEach(function(a){ a.addEventListener('click', function(){ nav.classList.remove('open'); }); });
  }
  var io = new IntersectionObserver(function(es){
    es.forEach(function(e){ if (e.isIntersecting){ e.target.classList.add('in'); io.unobserve(e.target); } });
  }, { threshold:.15 });
  document.querySelectorAll('.reveal:not(.in)').forEach(function(el){ io.observe(el); });
})();
