/* 공공데이터포털(apis.data.go.kr) 요청을 서버 경유로(2026-11-13)
 * 인증키를 홈페이지 코드(js/config.js)에 두면 누구나 가져다 하루 한도를 써 버릴 수 있다.
 * 이 파일은 apis.data.go.kr 로 가는 fetch를 가로채 관리자 로그인 상태로 서버 함수 dataGo(jbslab-auction, 서울 리전)에 맡긴다.
 * 서버가 비밀값 DATA_GO_KR_KEY를 붙여 대신 부른다 → 브라우저에는 키가 없어도 됨.
 * 서버 함수가 아직 배포 전이거나 실패하면 예전처럼 직접 부른다(config.js 키). 한 번 실패하면 이 화면에서는 다시 시도하지 않음.
 * 다른 화면 코드는 고칠 것 없음 — 예전처럼 fetch('https://apis.data.go.kr/...')를 쓰면 됨.
 */
(function () {
  if (window.__jbsDataGo) return; window.__jbsDataGo = true;
  var V = '10.12.2';
  var CFG = { apiKey: 'AIzaSyAaqAP7371502cfR3OpnYC33tTfE7EeqtI', authDomain: 'jbslab-auction.firebaseapp.com', projectId: 'jbslab-auction', appId: '1:780407673324:web:0506b356fb74a8c68a30c9' };
  var orig = window.fetch.bind(window);
  var down = false, callP = null;
  function caller() {
    if (callP) return callP;
    callP = Promise.all(['app', 'auth', 'functions'].map(function (m) { return import('https://www.gstatic.com/firebasejs/' + V + '/firebase-' + m + '.js'); }))
      .then(function (m) {
        var A = m[0], U = m[1], F = m[2];
        var app = A.getApps().length ? A.getApp() : A.initializeApp(CFG);
        var auth = U.getAuth(app);
        var fn = F.httpsCallable(F.getFunctions(app, 'asia-northeast3'), 'dataGo', { timeout: 60000 });
        return { fn: fn, auth: auth };
      });
    return callP;
  }
  function viaServer(url) {
    return caller().then(function (c) {
      if (!c.auth.currentUser) throw new Error('로그인 전');
      return c.fn({ url: url });
    }).then(function (r) {
      var d = r.data || {};
      return new Response(d.body || '', { status: d.status || 200, headers: { 'Content-Type': d.type || 'application/json' } });
    });
  }
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    if (down || !/^https:\/\/apis\.data\.go\.kr\//.test(url) || (init && init.method && init.method !== 'GET')) return orig(input, init);
    var u = new URL(url); u.searchParams.delete('serviceKey');
    return viaServer(u.toString()).catch(function (e) {
      if (!/로그인 전/.test(e && e.message)) down = true;   // 서버 함수가 없거나(배포 전) 오류면 이 화면에서는 계속 직접
      return orig(input, init);              // 예전처럼 직접(config.js 키)
    });
  };
  window.JbsDataGo = { get down() { return down; } };
})();
