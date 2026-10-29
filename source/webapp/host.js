/* 主持人頁面（建議投影到大螢幕） */
(function () {
  'use strict';
  var socket = io();
  var SHAPES = ['▲', '◆', '●', '■'];
  var COLORS = ['oa', 'ob', 'oc', 'od'];
  var LETTERS = ['A', 'B', 'C', 'D'];
  var SS_KEY = 'quiz_host_pin';
  var BACK = '<button class="btn ghost small" data-act="reset-keep" style="margin-left:auto">↩ 回到大廳</button>';

  var $ = function (id) { return document.getElementById(id); };
  var $play = $('play'), $edit = $('edit'), $tabs = $('tabs'), $online = $('online'), $title = $('title');

  var hs = null;          // 伺服器送來的主持狀態
  var authed = false;
  var tab = 'play';
  var localEnd = 0, raf = 0;
  var info = null;        // { port, lan: [] }
  var chosenIp = null;
  var draft = null, dirty = false;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function ssGet() { try { return sessionStorage.getItem(SS_KEY); } catch (e) { return null; } }
  function ssSet(v) { try { sessionStorage.setItem(SS_KEY, v); } catch (e) {} }

  fetch('info').then(function (r) { return r.json(); }).then(function (d) {
    info = d; if (!chosenIp && d.lan && d.lan.length) chosenIp = d.lan[0];
    if (hs && hs.phase === 'lobby' && tab === 'play') renderPlay();
  }).catch(function () {});

  // ---------- 登入 ----------
  function auth(pin, onFail) {
    socket.emit('host:auth', { pin: pin }, function (res) {
      if (res && res.ok) {
        authed = true; ssSet(pin);
        $('pin').classList.add('hidden');
        $tabs.classList.remove('hidden');
        $online.classList.remove('hidden');
        showTab(tab);
      } else if (onFail) onFail();
    });
  }
  socket.on('connect', function () {
    var saved = ssGet();
    if (saved) auth(saved, function () { $('pinerr').textContent = '請重新輸入密碼'; });
  });
  $('pf').addEventListener('submit', function (e) {
    e.preventDefault();
    auth($('pinin').value, function () { $('pinerr').textContent = '密碼錯誤'; });
  });

  socket.on('host:state', function (s) {
    var phaseChanged = !hs || hs.phase !== s.phase || hs.qIndex !== s.qIndex;
    hs = s;
    if (s.phase === 'question') localEnd = performance.now() + s.remainingMs;
    $title.textContent = s.title;
    document.title = '主持人｜' + s.title;
    $online.textContent = '在線 ' + s.online + ' / ' + s.players.length + ' 人';
    if (tab === 'play') {
      if (phaseChanged || s.phase !== 'question') renderPlay();
      else updateQuestionLive();
    }
    if (tab === 'edit') onEditorHostState();
  });

  // ---------- 分頁 ----------
  $tabs.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-tab]');
    if (b) showTab(b.getAttribute('data-tab'));
  });
  function showTab(t) {
    tab = t;
    Array.prototype.forEach.call($tabs.querySelectorAll('button'), function (b) {
      b.classList.toggle('on', b.getAttribute('data-tab') === t);
    });
    $play.classList.toggle('hidden', t !== 'play');
    $edit.classList.toggle('hidden', t !== 'edit');
    if (!hs) return;
    if (t === 'play') renderPlay();
    else openEditor();
  }

  // ---------- 主持畫面 ----------
  // 作答頁網址＝主持頁所在的資料夾（例如 http://伺服器:8080/quiz/）
  function joinUrl() {
    var base = new URL('./', location.href);
    var h = location.hostname;
    var local = h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1';
    if (local && chosenIp) return base.protocol + '//' + chosenIp + (base.port ? ':' + base.port : '') + base.pathname;
    return base.href;
  }

  function drawQr(url) {
    var box = $('qrbox');
    if (!box || typeof qrcode !== 'function') return;
    try {
      var qr = qrcode(0, 'M');
      qr.addData(url);
      qr.make();
      box.innerHTML = qr.createSvgTag({ cellSize: 8, margin: 2, scalable: true, alt: '加入測驗的 QR Code' });
    } catch (e) { box.textContent = 'QR Code 產生失敗，請直接輸入下方網址'; }
  }

  function stopTimer() { if (raf) cancelAnimationFrame(raf); raf = 0; }

  function renderPlay() {
    stopTimer();
    if (!hs) return;
    var p = hs.phase;
    if (p === 'lobby') renderLobby();
    else if (p === 'question') renderQuestion();
    else if (p === 'reveal') renderReveal();
    else if (p === 'leaderboard') renderBoard();
    else if (p === 'end') renderEnd();
  }

  function renderLobby() {
    var url = joinUrl();
    var h = location.hostname;
    var local = h === 'localhost' || h === '127.0.0.1';
    var picker = '';
    if (local && info && info.lan && info.lan.length > 1) {
      picker = '<select id="ipsel">' + info.lan.map(function (ip) {
        return '<option' + (ip === chosenIp ? ' selected' : '') + '>' + ip + '</option>';
      }).join('') + '</select>';
    }
    var warn = local && (!info || !info.lan || !info.lan.length)
      ? '<p class="err">找不到區網 IP，手機可能連不進來，請改用伺服器的 IP 或網域開啟主持頁。</p>' : '';
    var players = hs.players.map(function (x) {
      return '<span class="' + (x.connected ? '' : 'off') + '">' + esc(x.name) +
        '<button title="移出" data-kick="' + esc(x.id) + '">×</button></span>';
    }).join('');
    var n = hs.total;
    $play.innerHTML =
      '<div class="lobby">' +
        '<div class="qr"><div class="qrbox" id="qrbox"></div>' +
          '<div class="muted" style="margin-top:6px">手機掃描加入，或輸入網址</div>' +
          '<div class="url">' + esc(url) + '</div>' + picker + warn + '</div>' +
        '<div>' +
          '<h1 class="big-title">' + esc(hs.title) + '</h1>' +
          '<p class="muted" style="font-size:18px">共 ' + n + ' 題 · 已加入 <b style="color:var(--jade);font-size:28px">' + hs.players.length + '</b> / ' + hs.maxPlayers + ' 人</p>' +
          '<div class="actions">' +
            '<button class="btn" data-act="next" ' + (n ? '' : 'disabled') + '>開始第 1 題 ▶</button>' +
            '<span class="muted">（請用滑鼠點擊開始；開始後可以用空白鍵前進）</span>' +
          '</div>' +
          '<div class="pl-list">' + (players || '<span class="muted" style="box-shadow:none;background:none">等待大家加入…</span>') + '</div>' +
        '</div>' +
      '</div>';
    drawQr(url);
    var sel = $('ipsel');
    if (sel) sel.addEventListener('change', function () { chosenIp = sel.value; renderLobby(); });
  }

  function hostOptions(q, revealMode) {
    var html = '<div class="hopts">';
    for (var i = 0; i < 4; i++) {
      if (!q.options[i]) continue;
      var cls = 'hopt ' + COLORS[i];
      var tail = '';
      if (revealMode) {
        if (i !== q.answer) cls += ' wrong';
        tail = (i === q.answer ? '<span class="tick">✔</span>' : '') + '<span class="cnt">' + (hs.counts[i] || 0) + ' 人</span>';
      }
      html += '<div class="' + cls + '"><span class="shape">' + SHAPES[i] + '</span><span>' + esc(q.options[i]) + '</span>' + tail + '</div>';
    }
    return html + '</div>';
  }

  function renderQuestion() {
    var q = hs.question;
    $play.innerHTML =
      '<div class="hq-head"><span class="chip">第 ' + (hs.qIndex + 1) + ' / ' + hs.total + ' 題</span>' +
      '<div class="count" id="cnt"></div></div>' +
      '<div class="tbar" id="tbar"><i></i></div>' +
      '<h1 class="hq-text">' + esc(q.text) + '</h1>' +
      hostOptions(q, false) +
      '<div class="actions"><span class="chip" id="ans" style="font-size:18px"></span>' +
      '<button class="btn ghost" data-act="reveal" data-primary>提早公布答案</button>' + BACK + '</div>';
    updateQuestionLive();
    var total = q.seconds * 1000;
    function tick() {
      var left = Math.max(0, localEnd - performance.now());
      var c = $('cnt'), b = $('tbar');
      if (c) { c.textContent = Math.ceil(left / 1000); c.classList.toggle('warn', left < 5000); }
      if (b) { b.firstChild.style.transform = 'scaleX(' + (left / total) + ')'; b.classList.toggle('warn', left < 5000); }
      if (left > 0) raf = requestAnimationFrame(tick);
    }
    tick();
  }
  function updateQuestionLive() {
    var a = $('ans');
    if (a && hs) a.textContent = '已作答 ' + hs.answered + ' / ' + hs.players.length + ' 人';
  }

  function isLast() { return hs.qIndex + 1 >= hs.total; }

  function renderReveal() {
    var q = hs.question;
    var correct = hs.counts[q.answer] || 0;
    var answered = hs.counts.reduce(function (a, b) { return a + b; }, 0);
    $play.innerHTML =
      '<div class="hq-head"><span class="chip">第 ' + (hs.qIndex + 1) + ' / ' + hs.total + ' 題 · 答對 ' + correct + ' / ' + answered + ' 人</span></div>' +
      '<h1 class="hq-text">' + esc(q.text) + '</h1>' +
      hostOptions(q, true) +
      (q.explanation ? '<div class="explain" style="font-size:20px">💡 ' + esc(q.explanation) + '</div>' : '') +
      '<div class="actions"><button class="btn" data-act="leaderboard" data-primary>看排行榜 ▶</button>' +
      '<button class="btn ghost" data-act="next">' + (isLast() ? '直接看最終結果' : '跳過排行榜，下一題') + '</button>' + BACK + '</div>';
  }

  function moveTag(r) {
    if (!r.prevRank || r.prevRank === r.rank) return '';
    var d = r.prevRank - r.rank;
    return d > 0 ? ' <small class="up">▲' + d + '</small>' : ' <small class="down">▼' + (-d) + '</small>';
  }
  function boardHtml(list, showLast) {
    return '<ol class="board">' + list.map(function (r) {
      return '<li class="' + (r.connected ? '' : 'off') + '"><span class="rk">' + r.rank + '</span>' +
        '<span class="nm">' + esc(r.name) + moveTag(r) + '</span>' +
        '<span class="sc">' + r.score + (showLast && r.last ? '<small>+' + r.last + '</small>' : '') + '</span></li>';
    }).join('') + '</ol>';
  }

  function renderBoard() {
    $play.innerHTML =
      '<div class="hboard">' +
      '<div class="hq-head" style="margin-bottom:14px"><h1 class="big-title">📋 排行榜</h1><span class="chip">' + (hs.qIndex + 1) + ' / ' + hs.total + ' 題後</span></div>' +
      boardHtml(hs.players.slice(0, 10), true) +
      (hs.players.length > 10 ? '<p class="muted center">另有 ' + (hs.players.length - 10) + ' 人，大家的手機上都看得到完整排名</p>' : '') +
      '<div class="actions" style="margin-top:16px;justify-content:center">' +
      '<button class="btn" data-act="next" data-primary>' + (isLast() ? '看最終結果 🏆' : '下一題 ▶') + '</button>' + BACK + '</div></div>';
  }

  function renderEnd() {
    var top = hs.players.slice(0, 3);
    function pod(i, cls, medal) {
      var x = top[i];
      return '<div class="' + cls + '"><div class="medal">' + medal + '</div><div class="pn">' + (x ? esc(x.name) : '—') + '</div><div>' + (x ? x.score : '') + '</div></div>';
    }
    $play.innerHTML =
      '<div class="hboard">' +
      '<h1 class="big-title center">🏆 最終結果</h1>' +
      '<div class="podium" style="max-width:640px;margin:20px auto">' + pod(1, 'p2', '🥈') + pod(0, 'p1', '🥇') + pod(2, 'p3', '🥉') + '</div>' +
      boardHtml(hs.players, false) +
      '<div class="actions" style="margin-top:18px;justify-content:center">' +
      '<button class="btn ghost" data-act="reset-keep">回到大廳（保留玩家、分數歸零）</button>' +
      '<button class="btn danger" data-act="reset-all">全部清除</button></div></div>';
  }

  $play.addEventListener('click', function (e) {
    var kick = e.target.closest('[data-kick]');
    if (kick) {
      if (confirm('要把這位玩家移出嗎？')) socket.emit('host:kick', { id: kick.getAttribute('data-kick') });
      return;
    }
    var b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    doAct(b.getAttribute('data-act'));
  });

  function doAct(act) {
    if (act === 'next') socket.emit('host:next');
    else if (act === 'reveal') socket.emit('host:reveal');
    else if (act === 'leaderboard') socket.emit('host:leaderboard');
    else if (act === 'reset-keep') { if (confirm('回到大廳後分數會全部歸零，玩家保留。確定嗎？')) socket.emit('host:reset', { keepPlayers: true }); }
    else if (act === 'reset-all') { if (confirm('所有玩家都會被移出，需要重新加入。確定嗎？')) socket.emit('host:reset', { keepPlayers: false }); }
  }

  // 空白鍵／→ 前進；大廳和結束畫面不吃鍵盤，避免誤觸開始
  document.addEventListener('keydown', function (e) {
    if (tab !== 'play' || !authed) return;
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
    if (!hs || hs.phase === 'lobby' || hs.phase === 'end' || e.repeat) return;
    if (e.code === 'Space' || e.code === 'ArrowRight') {
      var b = $play.querySelector('[data-primary]');
      if (b && !b.disabled) { e.preventDefault(); b.click(); }
    }
  });

  // ---------- 題目編輯（自動儲存） ----------
  var base = null;            // 這次打開主持頁時的版本（「放棄修改」會回到這裡）
  var saveTimer = 0, saving = false, saveAgain = false, blocked = false, lastSaved = '';
  var navObserver = null;

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function blankQ() { return { text: '', options: ['', '', '', ''], answer: 0, seconds: 20, explanation: '' }; }
  function canSave() { return hs && (hs.phase === 'lobby' || hs.phase === 'end'); }
  function isDone(q) {
    var filled = q.options.filter(function (o) { return o.trim(); }).length;
    return !!(q.text.trim() && q.options[q.answer] && q.options[q.answer].trim() && filled >= 2);
  }
  function whyNot(q) {
    if (!q.text.trim()) return '缺題目';
    if (q.options.filter(function (o) { return o.trim(); }).length < 2) return '選項至少 2 個';
    if (!q.options[q.answer] || !q.options[q.answer].trim()) return '正確答案是空白選項';
    return '';
  }

  function openEditor() {
    if (!draft || !dirty) draft = clone(hs.quiz);
    if (!base) base = clone(hs.quiz);
    lastSaved = JSON.stringify(hs.quiz);
    renderEdit();
  }

  function onEditorHostState() {
    if (!draft) { openEditor(); return; }
    if (blocked && canSave()) { blocked = false; saveNow(); }
    renderCounts();
    setStatus();
  }

  function setStatus(msg, cls) {
    var n = $('snote');
    var f = $('fsave');
    var state = (blocked || (dirty && !canSave())) ? 'wait' : (saving || dirty) ? 'dirty' : 'ok';
    if (f) {
      f.className = 'fsave ' + state;
      f.innerHTML = state === 'ok' ? '✔ 已儲存'
        : state === 'wait' ? '⏸ 測驗中，結束後自動儲存'
        : (saving ? '⏳ 儲存中…' : '● 尚未儲存 · 點我儲存');
    }
    if (!n) return;
    if (msg) { n.className = 'save-note ' + (cls || ''); n.textContent = msg; return; }
    if (state === 'wait') { n.className = 'save-note bad'; n.textContent = '測驗進行中：修改先保留在這裡，回到大廳後會自動儲存'; }
    else if (state === 'dirty') { n.className = 'save-note muted'; n.textContent = '儲存中…'; }
    else { n.className = 'save-note ok'; n.textContent = '✔ 所有修改都已自動儲存'; }
  }

  function changed(structural) {
    dirty = true;
    if (structural) renderEdit();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 700);
    setStatus();
  }

  function saveNow() {
    clearTimeout(saveTimer);
    if (!draft) return;
    if (!canSave()) { blocked = true; setStatus(); return; }
    if (saving) { saveAgain = true; return; }
    var snapshot = JSON.stringify(draft);
    if (snapshot === lastSaved) { dirty = false; setStatus(); return; }
    saving = true; setStatus();
    socket.emit('host:saveQuiz', JSON.parse(snapshot), function (res) {
      saving = false;
      if (res && res.ok) {
        lastSaved = snapshot;
        if (JSON.stringify(draft) === snapshot) dirty = false;
        var t = new Date();
        var hhmm = ('0' + t.getHours()).slice(-2) + ':' + ('0' + t.getMinutes()).slice(-2) + ':' + ('0' + t.getSeconds()).slice(-2);
        if (!dirty) setStatus('✔ 已自動儲存（' + hhmm + '）', 'ok');
      } else if (res && /進行中/.test(res.error || '')) {
        blocked = true; setStatus();
      } else {
        setStatus((res && res.error) || '儲存失敗，請檢查黑色視窗是否還開著', 'bad');
      }
      if (saveAgain) { saveAgain = false; saveNow(); }
      else if (dirty && !blocked) saveTimer = setTimeout(saveNow, 700);
    });
  }

  window.addEventListener('beforeunload', function (e) {
    if (dirty || saving) { e.preventDefault(); e.returnValue = ''; }
  });

  function navItem(q, i) {
    var done = isDone(q);
    return '<li><button type="button" data-jump="' + i + '" id="nav-' + i + '" title="' + esc(q.text || '（尚未填寫題目）') + '">' +
      '<span class="num">' + (i + 1) + '</span>' +
      '<span class="t">' + (q.text.trim() ? esc(q.text) : '<i class="muted">（尚未填寫題目）</i>') + '</span>' +
      '<span class="dot' + (done ? '' : ' bad') + '" title="' + (done ? '可出題' : esc(whyNot(q))) + '"></span></button></li>';
  }

  function renderCounts() {
    var c = $('qcount');
    if (!c || !draft) return;
    var total = draft.questions.length;
    var done = draft.questions.filter(isDone).length;
    c.innerHTML = '共 <b>' + total + '</b> 題' + (total - done ? ' · <span class="bad-text">' + (total - done) + ' 題未完成</span>' : ' · 全部可出題');
  }

  function refreshQuestionMeta(i) {
    var q = draft.questions[i];
    if (!q) return;
    var li = $('nav-' + i);
    if (li) li.parentNode.outerHTML = navItem(q, i);
    var badge = $('badge-' + i);
    if (badge) {
      var done = isDone(q);
      badge.className = 'badge' + (done ? ' ok' : '');
      badge.textContent = done ? '可出題' : '未完成：' + whyNot(q);
    }
    renderCounts();
    markCurrentNav();
  }

  var currentNav = 0;
  function markCurrentNav() {
    Array.prototype.forEach.call($edit.querySelectorAll('[data-jump]'), function (b) {
      b.classList.toggle('on', Number(b.getAttribute('data-jump')) === currentNav);
    });
  }

  function renderEdit() {
    if (!draft) return;
    var secs = [10, 15, 20, 30, 45, 60, 90, 120];
    var cards = draft.questions.map(function (q, i) {
      var opts = '';
      for (var k = 0; k < 4; k++) {
        opts += '<div class="orow"><label class="' + COLORS[k] + '" title="設為正確答案"><input type="radio" name="ans' + i + '" data-q="' + i + '" data-f="answer" value="' + k + '"' + (q.answer === k ? ' checked' : '') + '>' + SHAPES[k] + ' ' + LETTERS[k] + '</label>' +
          '<input type="text" maxlength="100" data-q="' + i + '" data-f="opt" data-k="' + k + '" value="' + esc(q.options[k]) + '" placeholder="選項 ' + LETTERS[k] + (k > 1 ? '（可留空）' : '') + '"></div>';
      }
      var done = isDone(q);
      return '<div class="card qcard" id="q-' + i + '" data-idx="' + i + '">' +
        '<div class="qh"><div class="qh-l"><b>第 ' + (i + 1) + ' 題</b><span class="badge' + (done ? ' ok' : '') + '" id="badge-' + i + '">' + (done ? '可出題' : '未完成：' + esc(whyNot(q))) + '</span></div>' +
        '<div class="actions">' +
          '<button class="btn ghost small" data-eact="up" data-q="' + i + '"' + (i === 0 ? ' disabled' : '') + ' title="上移">↑</button>' +
          '<button class="btn ghost small" data-eact="down" data-q="' + i + '"' + (i === draft.questions.length - 1 ? ' disabled' : '') + ' title="下移">↓</button>' +
          '<button class="btn ghost small" data-eact="dup" data-q="' + i + '">複製</button>' +
          '<button class="btn danger small" data-eact="del" data-q="' + i + '">刪除</button></div></div>' +
        '<textarea rows="2" maxlength="200" data-q="' + i + '" data-f="text" placeholder="題目">' + esc(q.text) + '</textarea>' +
        opts +
        '<div class="qfoot"><span class="muted">點左邊色塊選「正確答案」</span><span style="flex:1"></span>' +
          '<label>作答時間 <select data-q="' + i + '" data-f="seconds">' + secs.map(function (s) {
            return '<option value="' + s + '"' + (q.seconds === s ? ' selected' : '') + '>' + s + ' 秒</option>';
          }).join('') + '</select></label></div>' +
        '<textarea rows="2" maxlength="300" data-q="' + i + '" data-f="explanation" placeholder="公布答案時顯示的解說（選填）">' + esc(q.explanation) + '</textarea>' +
        '</div>';
    }).join('');

    $edit.innerHTML =
      '<div class="edit-layout">' +
        '<aside class="card qnav">' +
          '<div class="qnav-head"><b>題目清單</b></div>' +
          '<div class="qcount" id="qcount"></div>' +
          '<ol class="qnav-list">' + draft.questions.map(navItem).join('') + '</ol>' +
          '<div class="qnav-actions">' +
            '<button class="btn small" data-eact="add">＋ 新增題目</button>' +
            '<button class="btn ghost small" data-eact="top">↑ 回到頂部</button>' +
          '</div>' +
        '</aside>' +
        '<div class="edit-main">' +
          '<div class="card edit-head" id="edit-top">' +
            '<label class="muted" for="titlein">測驗名稱</label>' +
            '<input class="titlein" id="titlein" type="text" maxlength="60" data-f="title" value="' + esc(draft.title) + '">' +
            '<div class="edit-btns">' +
              '<button class="btn" data-eact="save">儲存題目</button>' +
              '<button class="btn ghost" data-eact="revert">放棄修改</button>' +
            '</div>' +
            '<div class="save-note" id="snote"></div>' +
          '</div>' +
          (cards || '<div class="card center muted">還沒有題目，按左邊「＋ 新增題目」開始</div>') +
          '<button class="btn ghost" data-eact="add" style="justify-self:start">＋ 新增題目</button>' +
        '</div>' +
      '</div>' +
      '<button type="button" id="fsave" class="fsave ok" data-eact="save" title="儲存題目">✔ 已儲存</button>';
    renderCounts();
    setStatus();
    observeCards();
    markCurrentNav();
  }

  function observeCards() {
    if (navObserver) navObserver.disconnect();
    if (!('IntersectionObserver' in window)) return;
    navObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { currentNav = Number(en.target.getAttribute('data-idx')); markCurrentNav(); }
      });
    }, { rootMargin: '-90px 0px -60% 0px' });
    Array.prototype.forEach.call($edit.querySelectorAll('.qcard'), function (c) { navObserver.observe(c); });
  }

  function jumpTo(i, focus) {
    var card = $('q-' + i);
    if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    card.classList.remove('flash'); void card.offsetWidth; card.classList.add('flash');
    currentNav = i; markCurrentNav();
    if (focus) setTimeout(function () { var t = card.querySelector('textarea'); if (t) t.focus({ preventScroll: true }); }, 350);
  }

  $edit.addEventListener('input', function (e) {
    var t = e.target, f = t.getAttribute('data-f');
    if (!f || !draft) return;
    if (f === 'title') { draft.title = t.value; changed(false); return; }
    var i = Number(t.getAttribute('data-q'));
    var q = draft.questions[i];
    if (f === 'opt') q.options[Number(t.getAttribute('data-k'))] = t.value;
    else if (f === 'answer') q.answer = Number(t.value);
    else if (f === 'seconds') q.seconds = Number(t.value);
    else q[f] = t.value;
    refreshQuestionMeta(i);
    changed(false);
  });
  $edit.addEventListener('change', function (e) {
    var f = e.target.getAttribute('data-f');
    if (f === 'answer' || f === 'seconds') e.target.dispatchEvent(new Event('input', { bubbles: true }));
  });

  $edit.addEventListener('click', function (e) {
    var j = e.target.closest('[data-jump]');
    if (j) { jumpTo(Number(j.getAttribute('data-jump')), false); return; }
    var b = e.target.closest('[data-eact]');
    if (!b || b.disabled) return;
    var act = b.getAttribute('data-eact');
    var i = Number(b.getAttribute('data-q'));
    var qs = draft.questions;
    if (act === 'add') { qs.push(blankQ()); changed(true); jumpTo(qs.length - 1, true); }
    else if (act === 'del') { if (confirm('刪除第 ' + (i + 1) + ' 題？')) { qs.splice(i, 1); changed(true); jumpTo(Math.min(i, qs.length - 1), false); } }
    else if (act === 'dup') { qs.splice(i + 1, 0, clone(qs[i])); changed(true); jumpTo(i + 1, false); }
    else if (act === 'up' && i > 0) { qs.splice(i - 1, 0, qs.splice(i, 1)[0]); changed(true); jumpTo(i - 1, false); }
    else if (act === 'down' && i < qs.length - 1) { qs.splice(i + 1, 0, qs.splice(i, 1)[0]); changed(true); jumpTo(i + 1, false); }
    else if (act === 'top') { window.scrollTo({ top: 0, behavior: 'smooth' }); }
    else if (act === 'save') { saveNow(); }
    else if (act === 'revert') {
      if (confirm('放棄這次打開主持頁之後的所有修改，回到原本的題目？')) { draft = clone(base); changed(true); saveNow(); }
    }
  });
})();
