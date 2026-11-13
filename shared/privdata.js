/* 판단 자료 잠금 풀기(2026-11-13) — JbsPriv.json(주소)
 * 홈페이지에 올라가는 경매 판단 자료(judge·review의 .json)는 배포할 때 비밀번호로 잠가서 올린다(tools/seal-data.js, GitHub Actions).
 * 이 파일은 그 잠긴 자료를 브라우저에서 푼다. 비밀번호는 이 컴퓨터에 한 번만 넣으면 기억한다(localStorage 'jbsDataPass' —
 * 'jbs-'·'jbs.'로 시작하지 않아 작업 파일·홈페이지 작업 저장에 섞여 올라가지 않음).
 * 잠기지 않은 예전 자료(그냥 JSON)도 그대로 읽는다 — 배포 방식을 바꾸기 전·후 모두 동작.
 * 잠금 형식: { jbsEnc: 1, alg: 'AES-GCM', kdf: 'PBKDF2-SHA256', iter, salt, iv, ct }  (base64)
 */
(function () {
  var PASS_KEY = 'jbsDataPass';
  var keys = {};          // salt+비밀번호 → CryptoKey (한 화면 안에서만 기억)
  var asking = null;      // 비밀번호 묻는 창(여러 파일이 동시에 물어도 한 번만)

  function b64(s) { var bin = atob(s), u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
  function getPass() { try { return localStorage.getItem(PASS_KEY) || ''; } catch (e) { return ''; } }
  function setPass(p) { try { if (p) localStorage.setItem(PASS_KEY, p); else localStorage.removeItem(PASS_KEY); } catch (e) {} }

  function deriveKey(pass, salt, iter) {
    var id = salt + '|' + iter + '|' + pass;
    if (keys[id]) return keys[id];
    keys[id] = crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey'])
      .then(function (base) {
        return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: b64(salt), iterations: iter }, base,
          { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
      });
    return keys[id];
  }

  function open(env, pass) {
    return deriveKey(pass, env.salt, env.iter || 250000).then(function (k) {
      return crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(env.iv) }, k, b64(env.ct));
    }).then(function (buf) { return JSON.parse(new TextDecoder().decode(buf)); });
  }

  function ask(msg) {
    if (asking) return asking;
    asking = new Promise(function (resolve, reject) {
      var place = function () {
        var bg = document.createElement('div');
        bg.id = 'jbs-priv-ask';
        bg.style.cssText = 'position:fixed;inset:0;z-index:2147483640;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;font-family:"Noto Sans KR",sans-serif';
        bg.innerHTML = '<form style="background:#fff;border-radius:12px;padding:24px 22px;width:min(360px,calc(100% - 32px));box-shadow:0 8px 30px rgba(0,0,0,.2)">' +
          '<div style="font-size:17px;font-weight:700;margin-bottom:6px">판단 자료 비밀번호</div>' +
          '<p style="font-size:13px;line-height:1.6;color:#4b5563;margin:0 0 12px">' + (msg || '경매 판단 자료는 잠겨서 올라갑니다. GitHub 비밀값 JBS_DATA_KEY에 넣은 비밀번호를 한 번 넣으면 이 컴퓨터가 기억합니다.') + '</p>' +
          '<input type="password" autocomplete="current-password" style="width:100%;box-sizing:border-box;font-size:15px;padding:9px 10px;border:1px solid #cbd5e1;border-radius:8px" />' +
          '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px"><button type="button" data-x style="font-size:14px;padding:8px 14px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;cursor:pointer">닫기</button>' +
          '<button type="submit" style="font-size:14px;padding:8px 14px;border:0;border-radius:8px;background:#2563eb;color:#fff;cursor:pointer">열기</button></div></form>';
        document.body.appendChild(bg);
        var f = bg.querySelector('form'), inp = bg.querySelector('input');
        setTimeout(function () { inp.focus(); }, 30);
        f.onsubmit = function (e) { e.preventDefault(); var p = inp.value; bg.remove(); asking = null; p ? resolve(p) : reject(new Error('비밀번호를 넣지 않았습니다')); };
        bg.querySelector('[data-x]').onclick = function () { bg.remove(); asking = null; reject(new Error('비밀번호를 넣지 않았습니다')); };
      };
      if (document.body) place(); else document.addEventListener('DOMContentLoaded', place);
    });
    return asking;
  }

  function unseal(env, tries) {
    var p = getPass();
    var go = p ? Promise.resolve(p) : ask();
    return go.then(function (pass) {
      return open(env, pass).then(function (data) { setPass(pass); return data; }, function () {
        setPass('');
        if ((tries || 0) >= 4) throw new Error('비밀번호가 맞지 않습니다');
        return ask('비밀번호가 맞지 않습니다. 다시 넣어 주세요.').then(function (pp) { setPass(pp); return unseal(env, (tries || 0) + 1); });
      });
    });
  }

  function json(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error(url + ' ' + r.status);
      return r.json();
    }).then(function (d) {
      return d && d.jbsEnc === 1 ? unseal(d) : d;
    });
  }

  window.JbsPriv = { json: json, forget: function () { setPass(''); } };
})();
