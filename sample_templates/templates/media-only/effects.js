(function (root) {
  'use strict';
  var names = ['Hải lưu', 'Dạ tiệc', 'Sakura', 'Kiến trúc', 'Ánh kim', 'Chân trời', 'Quỹ đạo', 'Mưa kính', 'Vườn đêm', 'Hình học'];
  var active = null;
  function mount(layer, style, options) {
    if (active) active();
    var index = Number(String(style).replace('ani', ''));
    if (!layer || !/^ani(?:[1-9]|10)$/.test(style)) return function () {};
    var canvas = document.createElement('canvas'), cache = document.createElement('canvas');
    canvas.className = 'fx-canvas'; canvas.setAttribute('aria-hidden', 'true');
    layer.appendChild(canvas);
    var ctx = canvas.getContext('2d'), base = cache.getContext('2d');
    if (!ctx || !base) { canvas.remove(); return function () {}; }
    var width = 0, height = 0, unit = 1, raf = 0, last = -1000, stopped = false;
    var motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    var still = !!(options && options.static), seed = index * 719 + 37;
    function random() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
    var dots = [];
    for (var i = 0; i < 44; i++) dots.push({ x: random(), y: random(), r: random(), phase: random() * Math.PI * 2 });
    function edge(x) { return x < .5 ? x * .42 : .79 + (x - .5) * .42; }
    function line(c, color, points, thickness) {
      c.strokeStyle = color; c.lineWidth = (thickness || 1) * unit; c.beginPath();
      points.forEach(function (p, n) { if (n) c.lineTo(p[0] * width, p[1] * height); else c.moveTo(p[0] * width, p[1] * height); }); c.stroke();
    }
    function curve(c, color, coords, thickness) {
      c.strokeStyle = color; c.lineWidth = (thickness || 1) * unit; c.beginPath();
      c.moveTo(coords[0] * width, coords[1] * height);
      c.bezierCurveTo(coords[2] * width, coords[3] * height, coords[4] * width, coords[5] * height, coords[6] * width, coords[7] * height); c.stroke();
    }
    function dot(c, x, y, radius, color) { c.fillStyle = color; c.beginPath(); c.arc(x, y, radius * unit, 0, Math.PI * 2); c.fill(); }
    function ellipse(c, x, y, rx, ry, angle, color, thickness, start, end) {
      c.strokeStyle = color; c.lineWidth = (thickness || 1) * unit; c.beginPath();
      c.ellipse(x * width, y * height, rx * width, ry * height, angle, start || 0, end || Math.PI * 2); c.stroke();
    }
    function leaf(c, x, y, size, angle, color) {
      c.save(); c.translate(x, y); c.rotate(angle); c.fillStyle = color;
      c.beginPath(); c.moveTo(0, 0); c.bezierCurveTo(-size * .5, -size * .4, -size * .35, -size, 0, -size * 1.2);
      c.bezierCurveTo(size * .55, -size * .7, size * .5, -size * .3, 0, 0); c.fill(); c.restore();
    }
    function paintBase() {
      base.clearRect(0, 0, width, height);
      var i, x, y;
      if (index === 1) {
        for (i = 0; i < 11; i++) curve(base, 'rgba(121,198,198,.12)', [-.15,.12+i*.025,.15,-.12,.2,.52,.72,-.08], 1);
      } else if (index === 2) {
        for (i = 0; i < 4; i++) ellipse(base, 1.04, 1.16, .38+i*.035, .8+i*.05, -.2, 'rgba(226,184,121,.14)', 1);
        line(base, 'rgba(226,184,121,.28)', [[.06,.12],[.06,.07],[.16,.07]], 1);
        line(base, 'rgba(226,184,121,.28)', [[.84,.93],[.94,.93],[.94,.88]], 1);
      } else if (index === 3) {
        curve(base, '#a77d82', [1.04,.02,.84,.1,.87,.17,.7,.29], 2);
        curve(base, '#b88f92', [.96,.1,.91,.26,.96,.3,.87,.38], 1.3);
        curve(base, '#bd999a', [0,.98,.08,.91,.03,.79,.16,.77], 1.5);
        for (i = 0; i < 15; i++) {
          var u = i < 10 ? i/10 : (i-10)/5, v = 1-u;
          var bx = i < 10 ? v*v*v*1.04+3*v*v*u*.84+3*v*u*u*.87+u*u*u*.7 : 3*v*v*u*.08+3*v*u*u*.03+u*u*u*.16;
          var by = i < 10 ? v*v*v*.02+3*v*v*u*.1+3*v*u*u*.17+u*u*u*.29 : v*v*v*.98+3*v*v*u*.91+3*v*u*u*.79+u*u*u*.77;
          x = (bx+(dots[i].x-.5)*.035)*width; y = (by+(dots[i].y-.5)*.075)*height;
          line(base,'rgba(157,111,117,.35)',[[bx,by],[x/width,y/height]],.65);
          for (var p = 0; p < 5; p++) leaf(base, x, y, (6+dots[i].r*5)*unit, p*1.257, 'rgba(178,100,123,.24)');
          dot(base, x, y, 1.5, '#b58078');
        }
      } else if (index === 4) {
        for (i = -7; i < 12; i++) line(base, 'rgba(122,179,200,.13)', [[.66,.68],[i*.14,1.08]], 1);
        [.72,.78,.86,.97].forEach(function (y) { line(base,'rgba(122,179,200,.15)',[[0,y],[1,y]],1); });
        for (i = 0; i < 6; i++) {
          x = .78+i*.035; y = .1+i*.045;
          line(base, 'rgba(122,179,200,.18)', [[x,.6],[x,y],[x+.1,y+.09],[x+.1,.65]],1);
        }
        line(base, 'rgba(122,179,200,.3)', [[.06,.22],[.06,.09],[.24,.09]],1);
      } else if (index === 5) {
        for (i=0;i<9;i++) curve(base,'rgba(198,177,134,'+(.06+i*.013)+')',[-.1,.55+i*.018,.08,.8,.18,.35,.31,1.08],1);
        for (i=0;i<7;i++) curve(base,'rgba(198,177,134,.1)',[.64,-.1,.8,.3,.91,-.1,1.08,.63+i*.025],1);
      } else if (index === 6) {
        var sun = base.createRadialGradient(width*.79,height*.74,0,width*.79,height*.74,height*.14);
        sun.addColorStop(0,'rgba(250,214,161,.36)');sun.addColorStop(1,'rgba(250,214,161,0)');
        base.fillStyle=sun;base.fillRect(width*.6,height*.57,width*.35,height*.36);
        for(var depth=0;depth<3;depth++) {
          base.fillStyle=['#414354','#303847','#1a2936'][depth];
          for(i=0;i<26;i++) {
            var d=dots[(i+depth*7)%44], bw=width/24, bh=(.035+d.r*.12)*(1+depth*.2)*height;
            x=i*bw-width*.02;y=height*(.91+depth*.035)-bh;
            base.fillRect(x,y,bw+1,height-y);
            if(depth===1) for(var k=0;k<3;k++) { base.fillStyle='rgba(238,207,155,.24)';base.fillRect(x+bw*.25,y+8*unit+k*10*unit,2*unit,2*unit);base.fillStyle='#303847'; }
          }
        }
      } else if (index === 7) {
        for (i=0;i<44;i++) dot(base,edge(dots[i].x)*width,dots[i].y*height,.6+dots[i].r,'rgba(192,205,231,.35)');
        for(i=0;i<3;i++) ellipse(base,1.01,.03,.23+i*.045,.44+i*.055,-.27,'rgba(171,187,227,.22)',1);
        ellipse(base,-.08,1.08,.31,.42,-.4,'rgba(171,187,227,.12)',1);
      } else if (index === 8) {
        for(i=0;i<5;i++) line(base,'rgba(160,194,205,.055)',[[.05+i*.24,0],[-.06+i*.24,1]],14);
      } else if (index === 9) {
        for(var side=0;side<2;side++) {
          curve(base,'rgba(130,165,123,.17)',side?[1.03,1.05,.87,.8,.96,.44,.99,.27]:[-.04,1.05,.17,.86,.02,.5,.02,.34],1);
          for(i=0;i<10;i++) {
            var ratio=i/10, bend=Math.sin(ratio*Math.PI)*.055;
            x=(side?1-bend-.01:.02+bend)*width;y=(.31+ratio*.7)*height;
            var size=(13+Math.sin(ratio*Math.PI)*23+dots[i].r*7)*unit;
            leaf(base,x,y,size,(side?-.9:.9)+dots[i].r*.35,'rgba(94,143,111,'+(.1+ratio*.1)+')');
            leaf(base,x,y+10*unit,size*.72,side?.55:-.55,'rgba(115,153,110,.13)');
          }
        }
      } else if (index === 10) {
        base.fillStyle='rgba(167,105,79,.1)';base.fillRect(width*.85,0,width*.15,height);
        base.fillStyle='rgba(76,90,87,.06)';base.fillRect(0,height*.83,width*.4,height*.17);
        for(i=0;i<9;i++) line(base,'rgba(102,106,99,.12)',[[.04,.67+i*.024],[.17,.67+i*.024]],1);
        line(base,'rgba(102,106,99,.25)',[[.055,.08],[.2,.08]],1);
      }
    }
    function paint(time) {
      ctx.clearRect(0,0,width,height); ctx.drawImage(cache,0,0);
      var t=time*.001, i, d, x, y, a;
      if(index===1) {
        for(i=0;i<9;i++) {
          var offset=Math.sin(t*.12+i*.24)*.035;
          curve(ctx,'rgba(111,207,198,'+(.08+i*.012)+')',[-.08,.86+i*.021,.3,.59+offset,.7,1.16+offset,1.1,.69+i*.025],1.5);
        }
        for(i=0;i<12;i++) dot(ctx,edge(dots[i].x)*width,((dots[i].y+t*.008)%1)*height,1+dots[i].r*2,'rgba(158,216,209,.22)');
      } else if(index===2) {
        for(i=0;i<32;i++) { d=dots[i];x=(edge(d.x)+Math.sin(t*.16+d.phase)*.012)*width;y=((d.y-t*(.008+d.r*.006)+10)%1)*height;
          dot(ctx,x,y,1+d.r*2.1,'rgba(232,196,133,'+(.17+.14*Math.sin(t*.3+d.phase))+')'); }
      } else if(index===3) {
        for(i=0;i<16;i++) { d=dots[i];x=(edge(d.x)+Math.sin(t*.2+d.phase)*.026)*width;y=((d.y+t*(.012+d.r*.009))%1.15-.08)*height;
          leaf(ctx,x,y,(5+d.r*5)*unit,Math.sin(t*.25+d.phase)*.9+d.phase,'rgba(179,101,124,.32)'); }
      } else if(index===4) {
        for(i=0;i<7;i++) {d=dots[i];a=(t*.035+d.r)%1;x=(.66+(d.x*1.5-.7)*a)*width;y=(.68+.4*a*a)*height;dot(ctx,x,y,1.3,'rgba(140,211,226,.65)');}
        line(ctx,'rgba(153,214,228,.28)',[[.79,.1+(t*.015)% .45],[.93,.23+(t*.015)% .45]],1);
      } else if(index===5) {
        for(i=0;i<5;i++) {a=Math.sin(t*.11+i*.3)*.025;curve(ctx,'rgba(207,186,143,'+(.12+i*.025)+')',[.72,-.08,.59+a,.19,.96+a,.25,1.08,.66+i*.025],2+i*.4);}
        for(i=0;i<8;i++) dot(ctx,edge(dots[i].x)*width,((dots[i].y-t*.005+10)%1)*height,1,'rgba(216,197,157,.3)');
      } else if(index===6) {
        for(i=0;i<5;i++) {x=((dots[i].x+t*.014)%1)*width;y=height*(.935+(i%3)*.02);line(ctx,'rgba(255,219,165,.45)',[[x/width,y/height],[x/width+.008,y/height]],1);}
        for(i=0;i<3;i++) curve(ctx,'rgba(221,194,189,.09)',[-.1,.13+i*.025,.22,.17+Math.sin(t*.05)*.01,.55,.06,.78,.13+i*.025],1);
      } else if(index===7) {
        for(i=0;i<3;i++) {a=t*.055+i*2.1;x=width*(1.01+(.23+i*.045)*Math.cos(a));y=height*(.03+(.44+i*.055)*Math.sin(a));dot(ctx,x,y,2.2-i*.3,'rgba(213,220,242,.75)');}
        for(i=0;i<10;i++) dot(ctx,edge(dots[i].x)*width,dots[i].y*height,.8,'rgba(233,231,220,'+(.18+.14*Math.sin(t*.45+dots[i].phase))+')');
      } else if(index===8) {
        for(i=0;i<36;i++) {d=dots[i];y=(d.y+t*(.08+d.r*.05))%1.15-.08;x=edge(d.x)-y*.025;
          line(ctx,'rgba(179,212,220,'+(.1+d.r*.14)+')',[[x,y],[x-.004,y+.018+d.r*.022]],.8);}
        for(i=0;i<3;i++) {a=(t*.18+dots[i].y)%1;ellipse(ctx,edge(dots[i].x),.91+i*.02,.012+a*.018,.003+a*.005,0,'rgba(179,212,220,'+((1-a)*.18)+')',.8);}
      } else if(index===9) {
        for(i=0;i<18;i++) {d=dots[i];x=(edge(d.x)+Math.sin(t*.15+d.phase)*.025)*width;y=(d.y+Math.sin(t*.1+d.phase)*.035)*height;
          a=.15+.23*(.5+.5*Math.sin(t*.6+d.phase));dot(ctx,x,y,3+d.r*2,'rgba(205,215,141,'+(a*.13)+')');dot(ctx,x,y,.8+d.r,'rgba(220,223,158,'+a+')');}
      } else if(index===10) {
        for(i=0;i<4;i++) ellipse(ctx,.96,.16,.13+i*.026,.25+i*.046,0,'rgba(163,96,72,'+(.26-i*.035)+')',1.3,t*.035+i*.12,t*.035+Math.PI*1.35+i*.12);
        ellipse(ctx,-.06,.92,.19,.3,0,'rgba(83,103,98,.18)',2,t*.022,t*.022+Math.PI*1.2);
        var p=(Math.sin(t*.08)+1)*.5;line(ctx,'rgba(163,96,72,.4)',[[.05,.89],[.09+p*.07,.89]],2);
      }
    }
    function resize() {
      var bounds=layer.getBoundingClientRect(), scale=Math.min(1,960/Math.max(1,bounds.width),540/Math.max(1,bounds.height));
      width=Math.max(1,Math.round(bounds.width*scale));height=Math.max(1,Math.round(bounds.height*scale));unit=Math.min(width,height)/540;
      canvas.width=cache.width=width;canvas.height=cache.height=height;paintBase();
      if(!document.hidden)paint(performance.now());
    }
    function frame(now) {
      raf=0; if(stopped || document.hidden || motion.matches || still) return;
      if(now-last>=1000/24) {last=now-(now-last)%(1000/24);paint(now);}
      raf=requestAnimationFrame(frame);
    }
    function state() {
      if(raf)cancelAnimationFrame(raf);raf=0;
      if(stopped || document.hidden)return;
      paint(performance.now());last=-1000;
      if(!motion.matches&&!still)raf=requestAnimationFrame(frame);
    }
    function dispose() {
      if(stopped)return;stopped=true;if(raf)cancelAnimationFrame(raf);
      window.removeEventListener('resize',resize);document.removeEventListener('visibilitychange',state);
      motion.removeListener(state);canvas.remove();cache.width=cache.height=1;
      if(active===dispose)active=null;
    }
    active=dispose;resize();state();
    window.addEventListener('resize',resize);document.addEventListener('visibilitychange',state);motion.addListener(state);
    return dispose;
  }
  root.MediaOnlyEffects={mount:mount,names:names};
})(window);
