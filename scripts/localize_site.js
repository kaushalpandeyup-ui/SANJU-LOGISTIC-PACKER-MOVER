const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const TARGET = 'https://www.sanjulogisticspacker.com/';
const OUT_HTML = path.join(__dirname, '..', 'mobileview.local.html');
const VENDOR_DIR = path.join(__dirname, '..', 'vendor');

function fetchUrl(u){
  return new Promise((resolve,reject)=>{
    const urlObj = new URL(u);
    const getter = urlObj.protocol === 'https:' ? https.get : http.get;
    getter(u, (res)=>{
      if(res.statusCode >= 300 && res.statusCode < 400 && res.headers.location){
        // follow redirect
        return resolve(fetchUrl(new URL(res.headers.location, u).toString()));
      }
      if(res.statusCode !== 200){
        return reject(new Error('HTTP '+res.statusCode+' '+u));
      }
      const chunks = [];
      res.on('data', c=>chunks.push(c));
      res.on('end', ()=> resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

function ensureDir(dir){ if(!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }

(async function main(){
  console.log('Fetching target', TARGET);
  let htmlBuf;
  try{ htmlBuf = await fetchUrl(TARGET); }
  catch(err){ console.error('Failed to fetch target:', err.message); process.exit(1); }
  let html = htmlBuf.toString('utf8');

  // find all src/href absolute urls
  const urlSet = new Set();
  const attrRe = /(?:src|href)\s*=\s*["']([^"']+)["']/gmi;
  let m;
  while((m = attrRe.exec(html))){
    const val = m[1];
    if(!val) continue;
    if(/^https?:\/\//i.test(val)) urlSet.add(val);
    // also add protocol-relative
    else if(/^\/\//.test(val)) urlSet.add('https:'+val);
  }

  // filter for hosts we care about (wixstatic, parastorage, unpkg, google fonts, etc.)
  const includeHosts = [ 'static.wixstatic.com', 'static.parastorage.com', 'unpkg.com', 'unpkg__', 'www.googletagmanager.com', 'fonts.googleapis.com' ];
  const resources = Array.from(urlSet).filter(u=>{
    try{ const h = new URL(u).host; return includeHosts.some(x=>h.includes(x) || u.includes(x)); }catch(e){return false}
  });

  console.log('Found', resources.length, 'resources to download');
  for(const u of resources){
    try{
      const urlObj = new URL(u);
      const localDir = path.join(VENDOR_DIR, urlObj.host, path.dirname(urlObj.pathname));
      ensureDir(localDir);
      const filename = path.basename(urlObj.pathname) || 'resource';
      const localPath = path.join(localDir, filename);
      if(fs.existsSync(localPath)) { console.log('Skipped (exists):', u); continue; }
      console.log('Downloading:', u);
      const data = await fetchUrl(u);
      fs.writeFileSync(localPath, data);
      // replace occurrences in HTML with local path
      const webPath = '/vendor/' + urlObj.host + urlObj.pathname;
      const re = new RegExp(u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
      html = html.replace(re, webPath);
      // also replace protocol-relative
      const protoRel = '//' + urlObj.host + urlObj.pathname;
      html = html.replace(new RegExp(protoRel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), webPath);
    }catch(err){ console.warn('Failed to fetch', u, err.message); }
  }

  // Remove heavy third-party scripts to speed up load (Wix runtime bundles, react vendor, etc.)
  // This is conservative: remove script tags whose src contains these host fragments
  const heavyHosts = [ 'static.parastorage.com', 'unpkg__', 'react', 'react-dom', 'wix-thunderbolt', 'gtag', 'googletagmanager', 'core-js', 'lodash' ];
  html = html.replace(/<script[^>]*src=["'][^"']+["'][^>]*>\s*<\/?script>?/gmi, (match)=>{
    for(const h of heavyHosts){ if(match.includes(h)) return '<!-- removed heavy script -->'; }
    return match; // keep others
  });

  // Also rewrite inline images using static.wixstatic.com left (already handled by resources loop) but catch any remaining protocol-relative
  html = html.replace(/src=["']\/\//g, 'src="https://');

  // Save localized HTML
  fs.writeFileSync(OUT_HTML, html, 'utf8');
  console.log('Wrote localized HTML to', OUT_HTML);
  console.log('Done. Start your server and open mobileview.local.html via the wrapper.');
})();
