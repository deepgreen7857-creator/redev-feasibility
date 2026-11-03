/* jbslab.co.kr 전체 잠금(관리자 전용)
 * 모든 페이지 <head> 맨 앞에 <script src="/shared/gate.js"></script> 로 넣는다.
 * 관리자 Google 계정으로 로그인해야 화면이 보인다. 로그인 상태는 /data·/auction과 같이 쓴다(같은 Firebase 프로젝트).
 * 주의: 화면을 가리는 잠금이다. 저장소가 공개라 코드 자체는 GitHub에서 보인다. 진짜 자료(경매 원본 등)는 Firestore 규칙(isAdmin)으로 막혀 있다.
 */
(function () {
  var ADMIN = ['deepgreen7857@gmail.com'];
  var CFG = { apiKey: 'AIzaSyAaqAP7371502cfR3OpnYC33tTfE7EeqtI', authDomain: 'jbslab-auction.firebaseapp.com', projectId: 'jbslab-auction', appId: '1:780407673324:web:0506b356fb74a8c68a30c9' };
  var V = '10.12.2';

  // 1) 확인 전까지 화면 전체를 숨김
  var hide = document.createElement('style');
  hide.id = 'jbs-gate-hide';
  hide.textContent = 'html{visibility:hidden!important}#jbs-gate,#jbs-gate *{visibility:visible!important}';
  document.head.appendChild(hide);

  var box;
  function showBox(html) {
    if (!box) {
      box = document.createElement('div');
      box.id = 'jbs-gate';
      box.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:#f4f6f8;font-family:"Noto Sans KR",sans-serif;color:#1f2937';
      (document.body || document.documentElement).appendChild(box);
    }
    box.innerHTML = '<div style="background:#fff;border:1px solid #d9dee5;border-radius:12px;padding:32px 28px;max-width:360px;width:calc(100% - 32px);text-align:center;box-shadow:0 4px 18px rgba(0,0,0,.06)">' +
      '<div style="font-size:20px;font-weight:700;margin-bottom:8px">jbslab · 관리자 전용</div>' + html + '</div>';
  }
  function unlock(email) {
    if (box) { box.remove(); box = null; }
    var s = document.getElementById('jbs-gate-hide'); if (s) s.remove();
    addLogout(email);
  }
  function addLogout(email) {
    if (document.getElementById('jbs-gate-out')) return;
    var place = function () {
      var b = document.createElement('button');
      b.id = 'jbs-gate-out';
      b.title = email + ' 로그아웃';
      b.textContent = '로그아웃';
      b.style.cssText = 'position:fixed;left:10px;bottom:10px;z-index:2147483646;font:12px "Noto Sans KR",sans-serif;padding:5px 10px;border:1px solid #c9d0d8;border-radius:6px;background:rgba(255,255,255,.92);color:#374151;cursor:pointer;opacity:.75';
      b.onclick = function () { window.__jbsGateOut && window.__jbsGateOut(); };
      document.body.appendChild(b);
    };
    if (document.body) place(); else document.addEventListener('DOMContentLoaded', place);
  }

  var whenBody = function (fn) { if (document.body) fn(); else document.addEventListener('DOMContentLoaded', fn); };

  Promise.all([
    import('https://www.gstatic.com/firebasejs/' + V + '/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/' + V + '/firebase-auth.js')
  ]).then(function (m) {
    var A = m[0], U = m[1];
    var app = A.getApps().length ? A.getApp() : A.initializeApp(CFG);
    var auth = U.getAuth(app);
    window.__jbsGateOut = function () { U.signOut(auth).then(function () { location.reload(); }); };
    U.onAuthStateChanged(auth, function (u) {
      if (u && ADMIN.indexOf(u.email) >= 0) { unlock(u.email); return; }
      whenBody(function () {
        showBox('<p style="font-size:14px;line-height:1.6;margin:0 0 18px;color:#4b5563">' +
          (u ? '이 계정(' + u.email + ')은 들어올 수 없습니다.' : '관리자 Google 계정으로 로그인하세요.') + '</p>' +
          '<button id="jbs-gate-in" style="font:15px \'Noto Sans KR\',sans-serif;padding:10px 18px;border:0;border-radius:8px;background:#2563eb;color:#fff;cursor:pointer">' +
          (u ? '다른 계정으로 로그인' : 'Google로 로그인') + '</button><p id="jbs-gate-msg" style="font-size:12px;color:#b91c1c;margin:12px 0 0"></p>');
        document.getElementById('jbs-gate-in').onclick = function () {
          var p = new U.GoogleAuthProvider();
          p.setCustomParameters({ prompt: 'select_account' });
          (u ? U.signOut(auth) : Promise.resolve()).then(function () { return U.signInWithPopup(auth, p); })
            .catch(function (e) { document.getElementById('jbs-gate-msg').textContent = '로그인 실패: ' + e.message; });
        };
      });
    });
  }).catch(function () {
    // 인증 모듈을 못 불러오면 잠긴 채로 둔다
    whenBody(function () { showBox('<p style="font-size:14px;color:#4b5563;margin:0">로그인 모듈을 불러오지 못했습니다. 인터넷 연결을 확인하고 새로고침하세요.</p>'); });
  });
})();
