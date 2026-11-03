// A small app for lantern's tests: everything an agent meets in a real one. Login with a cookie, a form with
// every kind of control, a popup link, dialogs, a file upload, slow content, a long page, a hash-routed page,
// an iframe, console errors and failed requests, a page that asks before unloading.
import http from 'node:http'

const page = (title: string, body: string, head = '') => `<!doctype html><meta charset="utf-8"><title>${title}</title>
<style>body{font:16px -apple-system,system-ui;margin:0;background:#f6f7f8;color:#15191c} header{background:#1f6f3f;color:#fff;padding:16px 24px;font-weight:700} main{padding:24px;max-width:720px} .card{background:#fff;border-radius:12px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.1);margin-bottom:16px} button{background:#1f6f3f;color:#fff;border:0;border-radius:8px;padding:10px 16px;font-weight:600;cursor:pointer} input,select,textarea{padding:8px 10px;border:1px solid #cbd;border-radius:8px;font:inherit} .row{display:flex;gap:12px;align-items:center;margin:8px 0;flex-wrap:wrap} #result{font-size:28px;font-weight:800;color:#1f6f3f} nav a{margin-right:12px}</style>
${head}<header>Heat pump sizer</header><nav style="padding:8px 24px"><a href="/">Home</a><a href="/login">Login</a><a href="/secret">Secret</a><a href="/upload">Upload</a><a href="/slow">Slow</a><a href="/long">Long</a><a href="/spa">SPA</a><a href="/frame">Iframe</a><a href="/errors">Errors</a><a href="/unload">Unload</a><a href="/about" target="_blank" id="newtab">About (new tab)</a></nav><main>${body}</main>`

const routes: Record<string, (req: http.IncomingMessage, res: http.ServerResponse, body: string) => void> = {
  '/': (_q, res) => res.end(page('Lantern fixture', `
    <div class="card"><h2>Room</h2>
      <div class="row"><label>Name <input id="name" placeholder="Room name"></label><label>Type <select id="type"><option>Lounge</option><option>Bedroom</option><option>Kitchen</option></select></label></div>
      <div class="row"><label><input type="checkbox" id="ufh"> Underfloor heating</label><label><input type="radio" name="floor" value="ground" id="ground"> Ground</label><label><input type="radio" name="floor" value="first" id="first"> First</label></div>
      <div class="row"><label>Notes <textarea id="notes" rows="2"></textarea></label><div id="editor" contenteditable="true" style="border:1px solid #cbd;border-radius:8px;padding:8px;min-width:200px">edit me</div></div>
      <div class="row"><div id="dd" role="combobox" aria-label="Emitter" aria-expanded="false" style="border:1px solid #cbd;border-radius:8px;padding:8px;cursor:pointer">Radiator</div><ul id="ddlist" role="listbox" hidden style="list-style:none;margin:0;padding:4px;background:#fff;border:1px solid #cbd;border-radius:8px"><li role="option" style="padding:6px;cursor:pointer">Radiator</li><li role="option" style="padding:6px;cursor:pointer">Underfloor</li><li role="option" style="padding:6px;cursor:pointer">Fan coil</li></ul></div>
      <div class="row"><button id="calc">Calculate demand</button><button id="alert">Alert</button><button id="confirm">Confirm</button><button id="open">Open popup</button><button id="disabled" disabled>Disabled</button><div id="divbtn" style="cursor:pointer;padding:8px;background:#dfe6e2;border-radius:8px">A clickable div</div></div>
    </div>
    <div class="card"><h2>Result</h2><div id="result">—</div><p id="note">Fill in the room and press calculate.</p><div role="status" id="status"></div></div>
    <div class="card"><h2>Slider</h2><div id="track" style="position:relative;height:24px;background:#dfe6e2;border-radius:12px"><div id="knob" style="position:absolute;left:0;top:0;width:24px;height:24px;border-radius:12px;background:#1f6f3f;cursor:grab"></div></div><p>Knob at <span id="knobx">0</span>px</p></div>
    <div class="card" style="height:1400px">a long way down</div>
    <script>
      const $ = (s) => document.querySelector(s)
      $('#calc').onclick = () => { const n = $('#name').value || 'the room'; const t = $('#type').value; $('#result').textContent = (t === 'Kitchen' ? 1.8 : 1.2).toFixed(1) + ' kW'; $('#note').textContent = 'Demand for ' + n + ' (' + t + ($('#ufh').checked ? ', underfloor' : '') + ')'; $('#status').textContent = 'Calculated'; console.warn('calculated for ' + n) }
      $('#alert').onclick = () => { alert('An alert'); $('#status').textContent = 'Alert dismissed' }
      $('#confirm').onclick = () => { $('#status').textContent = confirm('Sure?') ? 'Confirmed' : 'Cancelled' }
      $('#open').onclick = () => window.open('/about', '_blank')
      $('#divbtn').onclick = () => { $('#status').textContent = 'Div clicked' }
      $('#dd').onclick = () => { const l = $('#ddlist'); l.hidden = !l.hidden; $('#dd').setAttribute('aria-expanded', String(!l.hidden)) }
      for (const li of document.querySelectorAll('#ddlist li')) li.onclick = () => { $('#dd').textContent = li.textContent; $('#ddlist').hidden = true; $('#dd').setAttribute('aria-expanded', 'false') }
      document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.metaKey) $('#status').textContent = 'cmd+Enter' })
      $('#name').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#calc').click() })
      const knob = $('#knob'); let drag = null
      knob.addEventListener('mousedown', (e) => { drag = e.clientX - knob.offsetLeft; e.preventDefault() })
      document.addEventListener('mousemove', (e) => { if (drag === null) return; const x = Math.max(0, Math.min($('#track').clientWidth - 24, e.clientX - drag)); knob.style.left = x + 'px'; $('#knobx').textContent = String(Math.round(x)) })
      document.addEventListener('mouseup', () => { drag = null })
    </script>`)),
  '/about': (_q, res) => res.end(page('About', `<h1>About page</h1><p>Opened at ${new Date().toISOString()}</p>`)),
  '/login': (req, res, body) => {
    if (req.method === 'POST') { const p = new URLSearchParams(body); if (p.get('email') === 'dev@example.com' && p.get('password') === 'secret') { res.writeHead(302, { 'Set-Cookie': 'session=ok; Path=/', Location: '/secret' }); return res.end() } return res.end(page('Login', `<p role="alert">Wrong email or password</p>${LOGIN}`)) }
    res.end(page('Login', LOGIN))
  },
  '/secret': (req, res) => { if (!/session=ok/.test(req.headers.cookie ?? '')) { res.writeHead(302, { Location: '/login' }); return res.end() } res.end(page('Secret', `<h1>Welcome, dev</h1><p>You are logged in.</p>`)) },
  '/upload': (_q, res) => res.end(page('Upload', `<div class="card"><label>Photo <input type="file" id="file"></label><button id="pick">Choose a file</button><p id="picked">nothing yet</p></div><script>const f=document.getElementById('file');f.onchange=()=>{document.getElementById('picked').textContent='picked '+[...f.files].map(x=>x.name).join(', ')};document.getElementById('pick').onclick=()=>f.click()</script>`)),
  '/slow': (_q, res) => res.end(page('Slow', `<div class="card"><p id="s">Loading…</p></div><script>setTimeout(()=>{document.getElementById('s').textContent='Finally loaded'},1500)</script>`)),
  '/long': (_q, res) => res.end(page('Long', Array.from({ length: 40 }, (_, i) => `<div class="card"><h2>Section ${i + 1}</h2><p>${i === 39 ? 'The very bottom' : 'Lorem ipsum'}</p></div>`).join(''))),
  '/spa': (_q, res) => res.end(page('SPA', `<div class="card"><a href="#/one" id="one">One</a> <a href="#/two" id="two">Two</a><h2 id="view">Home view</h2></div><script>const r=()=>{document.getElementById('view').textContent=location.hash==='#/one'?'One view':location.hash==='#/two'?'Two view':'Home view'};addEventListener('hashchange',r);r()</script>`)),
  '/frame': (_q, res) => res.end(page('Iframe', `<div class="card"><p>Outside the frame</p><iframe src="/about" style="width:600px;height:200px"></iframe></div>`)),
  '/errors': (_q, res) => res.end(page('Errors', `<div class="card"><p>This page misbehaves</p></div><script>console.error('something broke'); fetch('/missing'); setTimeout(()=>{throw new Error('uncaught boom')},100)</script>`)),
  '/unload': (_q, res) => res.end(page('Unload', `<div class="card"><p>Unsaved changes</p></div><script>addEventListener('beforeunload',(e)=>{e.preventDefault();e.returnValue=''})</script>`)),
}
const LOGIN = `<div class="card"><form method="post" action="/login"><div class="row"><label>Email <input type="email" name="email" id="email"></label></div><div class="row"><label>Password <input type="password" name="password" id="password"></label></div><button type="submit">Log in</button></form></div>`

export function start(port = 0): Promise<{ url: string; close: () => void }> {
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (d) => (body += d))
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://x')
      const h = routes[url.pathname]
      if (!h) { res.writeHead(404); return res.end('not found') }
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      h(req, res, body)
    })
  })
  return new Promise((r) => server.listen(port, '127.0.0.1', () => { const a = server.address() as { port: number }; r({ url: `http://127.0.0.1:${a.port}`, close: () => server.close() }) }))
}

if (process.argv[1] && process.argv[1].endsWith('server.ts') && process.argv.includes('--serve')) start(Number(process.argv[process.argv.indexOf('--serve') + 1] || 8765)).then(({ url }) => console.log(url))
