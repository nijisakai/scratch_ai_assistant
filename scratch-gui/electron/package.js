const { packager } = require('@electron/packager');
const path = require('path');
const fs = require('fs');

function copyFolderSync(from, to) {
    fs.mkdirSync(to, { recursive: true });
    fs.readdirSync(from).forEach(element => {
        const src = path.join(from, element);
        const dest = path.join(to, element);
        if (fs.lstatSync(src).isFile()) {
            fs.copyFileSync(src, dest);
        } else {
            copyFolderSync(src, dest);
        }
    });
}

async function bundle() {
    console.log('馃殌 寮€濮嬫墦鍖?Scratch AI Assistant...\n');
    
    console.log('[1/3] 鎵撳寘 Electron 搴旂敤...');
    const appPaths = await packager({
        dir: '.',
        name: 'Scratch AI Assistant',
        platform: 'win32',
        arch: 'x64',
        out: 'dist-portable',
        overwrite: true,
        asar: false,
        prune: true,
        ignore: [
            /^\/src/,
            /^\/test/,
            /^\/docs/,
            /^\/translations/,
            /^\/scripts/,
            /^\/static/,
            /^\/\.github/,
            /^\/\.husky/,
            /^\/\.tx/,
            /^\/dist$/,
            /^\/dist-electron/,
            /^\/dist-release/,
            /^\/\.git/,
            /^\/\.eslint/,
            /^\/\.editor/,
            /^\/\.babel/,
            /^\/\.npm/,
            /^\/\.browserslist/,
            /\.map$/,
            /^\/CHANGELOG/,
            /^\/electron-builder\.json/,
            /^\/webpack\.config/,
            /^\/commitlint/,
            /^\/renovate/,
            /^\/release\.config/,
        ]
    });

    const outputDir = appPaths[0];
    const resourcesDir = path.join(outputDir, 'resources');

    console.log('[2/3] 宓屽叆 Python 鍚庣 (app.exe)...');
    const pythonSrc = path.join(__dirname, '..', '..', 'python-dist', 'app');
    const pythonDest = path.join(resourcesDir, 'python-dist', 'app');
    
    if (fs.existsSync(pythonSrc)) {
        copyFolderSync(pythonSrc, pythonDest);
        console.log(`    鉁?Python 鍚庣宸插鍒跺埌: ${pythonDest}`);
    } else {
        console.error(`    鉂?鎵句笉鍒?Python 鍚庣: ${pythonSrc}`);
    }

    console.log('[3/3] 宓屽叆榛樿 AI 浜鸿閰嶇疆...');
    const personaSrc = path.join(__dirname, '..', '..', 'ai_persona.md');
    const defaultsDir = path.join(resourcesDir, 'defaults');
    const personaDest = path.join(defaultsDir, 'ai_persona.md');
    
    fs.mkdirSync(defaultsDir, { recursive: true });
    if (fs.existsSync(personaSrc)) {
        fs.copyFileSync(personaSrc, personaDest);
        console.log(`    鉁?AI 浜鸿宸插鍒跺埌: ${personaDest}`);
    } else {
        console.error(`    鉂?鎵句笉鍒?ai_persona.md: ${personaSrc}`);
    }

    console.log(`\n馃帀 鎵撳寘瀹屾垚锛乗n`);
}

bundle().catch(err => {
    console.error('鉂?鎵撳寘澶辫触:', err);
    process.exit(1);
});

