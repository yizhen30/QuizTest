/* 作答者頁面 */
(function () {
  'use strict';
  var socket = io();
  var $app = document.getElementById('app');
  var $title = document.getElementById('title');
  var $score = document.getElementById('scorechip');
  var LS_KEY = 'quiz_player_id';
  var SHAPES = ['▲', '◆', '●', '■'];
  var COLORS = ['oa', 'ob', 'oc', 'od'];

  var state = null;
  var mode = 'connecting'; // connecting | join | game
  var localEnd = 0;
  var raf = 0;
  var lastScrollKey = '';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function getId() { try { return localStorage.getItem(LS_KEY); } catch (e) { return null; } }
  function setId(v) { try { if (v) localStorage.setItem(LS_KEY, v); else localStorage.removeItem(LS_KEY); } catch (e) {} }

  socket.on('connect', function () {
    var id = getId();
    if (id) {
      socket.emit('player:join', { id: id }, function (res) {
        if (!res || !res.ok) { setId(null); showJoin(''); }
        else mode = 'game';
      });
    } else if (mode !== 'join') {
      showJoin('');
    }
  });

  socket.on('disconnect', function () {
    if (mode === 'game') $score.textContent = '重新連線中…';
  });

  socket.on('state', function (s) {
    state = s;
    mode = 'game';
    if (s.phase === 'question') localEnd = performance.now() + (s.remainingMs || 0);
    render();
  });

  socket.on('answered', function (d) {
    if (state && state.phase === 'question') { state.myAnswer = d.choice; render(); }
  });

  socket.on('kicked', function (d) {
    setId(null);
    state = null;
    showJoin((d && d.reason) || '');
  });

  // ---------- 加入 ----------
  function showJoin(msg) {
    mode = 'join';
    stopTimer();
    $score.classList.add('hidden');
    $app.innerHTML =
      '<div class="hero"><div class="big">🌿</div><h1>加入測驗</h1><p class="muted">輸入一個暱稱，排行榜會顯示這個名字</p></div>' +
      '<form id="jf" class="card" autocomplete="off">' +
      '<input class="field" id="nm" maxlength="16" placeholder="你的暱稱（最多 16 字）" enterkeyhint="go">' +
      '<div class="err" id="er">' + esc(msg) + '</div>' +
      '<button class="btn" style="width:100%" type="submit">加入</button>' +
      '</form>';
    var f = document.getElementById('jf');
    var nm = document.getElementById('nm');
    var er = document.getElementById('er');
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = nm.value.trim();
      if (!name) { er.textContent = '請輸入暱稱'; return; }
      er.textContent = '';
      socket.emit('player:join', { name: name }, function (res) {
        if (res && res.ok) { setId(res.id); mode = 'game'; }
        else er.textContent = (res && res.error) || '加入失敗，請再試一次';
      });
    });
  }

  // ---------- 畫面 ----------
  function render() {
    if (!state) return;
    $title.textContent = state.title || '課堂小測驗';
    document.title = state.title || '課堂小測驗';
    $score.classList.remove('hidden');
    $score.textContent = state.me.name + ' · ' + state.me.score + ' 分';
    stopTimer();
    var p = state.phase;
    if (p === 'lobby') return renderLobby();
    if (p === 'question') return renderQuestion();
    if (p === 'reveal' || p === 'leaderboard') return renderReveal();
    if (p === 'end') return renderEnd();
  }

  function renderLobby() {
    var names = (state.names || []).map(function (n) { return '<span>' + esc(n) + '</span>'; }).join('');
    $app.innerHTML =
      '<div class="hero"><div class="big">✅</div>' +
      '<h1>嗨，' + esc(state.me.name) + '！</h1>' +
      '<p class="muted">已成功加入，等待主持人開始…</p>' +
      '<p><span class="chip">目前 ' + state.playerCount + ' 人</span></p>' +
      '<div class="names">' + names + '</div></div>';
  }

  function optionButtons(q, picked, disabled) {
    var html = '';
    for (var i = 0; i < 4; i++) {
      if (!q.options[i]) continue;
      var cls = 'opt ' + COLORS[i];
      if (picked !== null && picked !== undefined) cls += picked === i ? ' picked' : ' dim';
      html += '<button class="' + cls + '" data-i="' + i + '"' + (disabled ? ' disabled' : '') + '>' +
        '<span class="shape">' + SHAPES[i] + '</span><span>' + esc(q.options[i]) + '</span></button>';
    }
    return html;
  }

  function renderQuestion() {
    var q = state.question;
    var answered = state.myAnswer !== null && state.myAnswer !== undefined;
    $app.innerHTML =
      '<div class="qmeta"><span>第 ' + (state.qIndex + 1) + ' / ' + state.total + ' 題</span><span id="tsec"></span></div>' +
      '<div class="tbar" id="tbar"><i></i></div>' +
      '<div class="qtext">' + esc(q.text) + '</div>' +
      '<div class="opts">' + optionButtons(q, answered ? state.myAnswer : null, answered) + '</div>' +
      (answered ? '<p class="center muted" style="margin-top:16px;font-weight:700">已送出！等待公布答案…</p>' : '');
    if (!answered) {
      Array.prototype.forEach.call($app.querySelectorAll('.opt'), function (b) {
        b.addEventListener('click', function () {
          var i = Number(b.getAttribute('data-i'));
          state.myAnswer = i;
          socket.emit('player:answer', { choice: i });
          if (navigator.vibrate) navigator.vibrate(30);
          render();
        });
      });
    }
    startTimer(q.seconds);
  }

  function startTimer(total) {
    var bar = document.querySelector('#tbar');
    var sec = document.querySelector('#tsec');
    function tick() {
      var left = Math.max(0, localEnd - performance.now());
      var ratio = total > 0 ? left / (total * 1000) : 0;
      if (bar) {
        bar.firstChild.style.transform = 'scaleX(' + ratio + ')';
        bar.classList.toggle('warn', left < 5000);
      }
      if (sec) sec.textContent = '⏱ ' + Math.ceil(left / 1000) + ' 秒';
      if (left > 0) raf = requestAnimationFrame(tick);
    }
    tick();
  }
  function stopTimer() { if (raf) cancelAnimationFrame(raf); raf = 0; }

  function moveTag(r) {
    if (!r.prevRank || !r.rank || r.prevRank === r.rank) return '';
    var d = r.prevRank - r.rank;
    return d > 0 ? ' <small class="up">▲' + d + '</small>' : ' <small class="down">▼' + (-d) + '</small>';
  }

  function boardHtml(list, showLast) {
    return '<ol class="board">' + list.map(function (r) {
      return '<li class="' + (r.me ? 'me' : '') + '"' + (r.me ? ' id="meRow"' : '') + '>' +
        '<span class="rk">' + r.rank + '</span>' +
        '<span class="nm">' + esc(r.name) + (r.me ? ' <small class="muted">（你）</small>' : '') + moveTag(r) + '</span>' +
        '<span class="sc">' + r.score + (showLast && r.last ? '<small>+' + r.last + '</small>' : '') + '</span></li>';
    }).join('') + '</ol>';
  }

  function renderReveal() {
    var q = state.question;
    var r = state.result || {};
    var head;
    if (r.choice === null || r.choice === undefined) head = '<div class="result none"><div class="r1">⌛ 時間到</div><div class="r2">這題沒有作答</div></div>';
    else if (r.correct) head = '<div class="result ok"><div class="r1">🎉 答對了！</div><div class="r2">+' + r.points + ' 分</div></div>';
    else head = '<div class="result no"><div class="r1">再接再厲！</div><div class="r2">這題答錯了</div></div>';

    var a = state.answer;
    var ans = '<div class="answer-line ' + COLORS[a] + '"><span class="shape">' + SHAPES[a] + '</span><span>正確答案：' + esc(q.options[a]) + '</span></div>';
    var exp = state.explanation ? '<div class="explain">💡 ' + esc(state.explanation) + '</div>' : '';
    var me = state.me;
    var mv = moveTag({ rank: me.rank, prevRank: me.prevRank });
    var stat = '<div class="mystat"><span class="chip">目前第 ' + me.rank + ' 名' + mv + '</span><span class="chip">總分 ' + me.score + '</span></div>';

    $app.innerHTML = head + ans + exp + stat +
      '<h2>📋 排行榜（' + (state.qIndex + 1) + ' / ' + state.total + ' 題後）</h2>' +
      boardHtml(state.leaderboard || [], true);
    scrollMe('r' + state.qIndex + state.phase);
  }

  function renderEnd() {
    var list = state.leaderboard || [];
    var top = list.slice(0, 3);
    function pod(i, cls, medal) {
      var x = top[i];
      return '<div class="' + cls + '"><div class="medal">' + medal + '</div><div class="pn">' + (x ? esc(x.name) : '—') + '</div><div>' + (x ? x.score : '') + '</div></div>';
    }
    $app.innerHTML =
      '<div class="hero" style="padding-bottom:6px"><div class="big">🏆</div><h1>測驗結束！</h1>' +
      '<p style="font-size:20px;font-weight:800">你是第 ' + state.me.rank + ' 名 · ' + state.me.score + ' 分</p></div>' +
      '<div class="podium">' + pod(1, 'p2', '🥈') + pod(0, 'p1', '🥇') + pod(2, 'p3', '🥉') + '</div>' +
      '<h2>完整排名</h2>' + boardHtml(list, false);
    scrollMe('end');
  }

  function scrollMe(key) {
    if (key === lastScrollKey) return;
    lastScrollKey = key;
    var row = document.getElementById('meRow');
    if (row && row.getBoundingClientRect().top > window.innerHeight) {
      setTimeout(function () { row.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 600);
    }
  }
})();
