const { app, BrowserWindow, Menu, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

// 保持对window对象的全局引用，避免GC
let mainWindow;
let settingsWindow;
let pythonProcess = null;

/**
 * 获取用户数据目录（可写），用于存放 .env 和 ai_persona.md
 * 打包后：%APPDATA%/Scratch AI Assistant/
 * 开发时：项目根目录
 */
function getUserDataDir() {
    if (app.isPackaged) {
        return app.getPath('userData');
    }
    // 开发模式：使用项目根目录（scratch_ai_assistant/）
    return path.join(__dirname, '..', '..');
}

/**
 * 首次启动时，将默认的 ai_persona.md 复制到用户数据目录
 */
function ensureDefaults() {
    try {
        const userDir = getUserDataDir();
        if (!fs.existsSync(userDir)) {
            fs.mkdirSync(userDir, { recursive: true });
            console.log('Created userData dir at:', userDir);
        }
        
        const personaDest = path.join(userDir, 'ai_persona.md');

        if (!fs.existsSync(personaDest)) {
            let defaultPersona;
            if (app.isPackaged) {
                defaultPersona = path.join(process.resourcesPath, 'defaults', 'ai_persona.md');
            } else {
                defaultPersona = path.join(__dirname, '..', '..', 'ai_persona.md');
            }
            if (fs.existsSync(defaultPersona)) {
                fs.copyFileSync(defaultPersona, personaDest);
                console.log('Copied default ai_persona.md to:', personaDest);
            }
        }
    } catch (err) {
        console.error('ensureDefaults failed:', err);
    }
}

function startPythonBackend() {
    if (pythonProcess) return; // 已经启动了

    const userDataDir = getUserDataDir();

    if (app.isPackaged) {
        // 打包模式：从 resources/python-dist/app/ 启动 app.exe
        const pyExePath = path.join(process.resourcesPath, 'python-dist', 'app', 'app.exe');
        if (fs.existsSync(pyExePath)) {
            console.log('Starting bundled Python backend from:', pyExePath);
            pythonProcess = spawn(pyExePath, [], {
                cwd: path.dirname(pyExePath),
                env: { ...process.env, APP_DATA_DIR: userDataDir }
            });
        } else {
            console.error('Bundled app.exe not found at:', pyExePath);
            return;
        }
    } else {
        // 开发模式：调用系统 python
        const candidatePaths = [
            path.join(__dirname, '../../app.py'),
            path.join(app.getAppPath(), '../app.py'),
        ];
        let appPyPath = candidatePaths.find(p => fs.existsSync(p));
        
        if (appPyPath) {
            console.log('Starting Python backend from:', appPyPath);
            pythonProcess = spawn('python', [appPyPath], {
                cwd: path.dirname(appPyPath),
                env: { ...process.env, APP_DATA_DIR: userDataDir }
            });
        } else {
            console.error('Could not find app.py! Cannot start Python backend.');
            return;
        }
    }

    let startupLogs = '';
    pythonProcess.stdout.on('data', (data) => console.log(`Python: ${data}`));
    pythonProcess.stderr.on('data', (data) => {
        const text = data.toString();
        console.error(`Python Error: ${text}`);
        startupLogs += text;
        if (startupLogs.length > 800) startupLogs = startupLogs.substring(startupLogs.length - 800);
    });
    
    pythonProcess.on('exit', (code, signal) => {
        console.log(`Python backend exited with code ${code} and signal ${signal}`);
        if (code !== 0 && code !== null) {
            const { dialog } = require('electron');
            dialog.showErrorBox(
                '❌ AI 核心引擎异常终止',
                `后端的 Python 微服务 (端口 5001) 意外崩溃了！\n(退出码: ${code})\n\n这通常是因为：\n1. 您的电脑上 5001 端口已被其他后台程序占用。\n2. 或者缺少运行库依赖。\n\n【诊断日志】\n${startupLogs.trim() || '无日志输出'}`
            );
        }
        pythonProcess = null;
    });
}

function openSettingsWindow() {
    if (settingsWindow) {
        settingsWindow.focus();
        return;
    }
    settingsWindow = new BrowserWindow({
        width: 800,
        height: 700,
        title: '配置 API 与 AI 人设',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true
        }
    });
    settingsWindow.setMenu(null);
    settingsWindow.loadFile(path.join(__dirname, 'settings.html'));
    settingsWindow.on('closed', () => {
        settingsWindow = null;
    });
}

// IPC Handlers - 使用 userData 目录读写配置
ipcMain.handle('get-settings', async () => {
    try {
        const userDir = getUserDataDir();
        const envPath = path.join(userDir, '.env');
        const personaPath = path.join(userDir, 'ai_persona.md');
        let apiKeys = '';
        let persona = '';
        if (fs.existsSync(envPath)) {
            const envContent = fs.readFileSync(envPath, 'utf8');
            const match = envContent.match(/^DASHSCOPE_API_KEYS=(.*)$/m);
            if (match) apiKeys = match[1].trim();
        }
        if (fs.existsSync(personaPath)) {
            persona = fs.readFileSync(personaPath, 'utf8');
        }
        return { apiKeys, persona };
    } catch (e) {
        console.error("Error reading settings", e);
        return { apiKeys: '', persona: '' };
    }
});

ipcMain.handle('save-settings', async (event, config) => {
    try {
        const userDir = getUserDataDir();
        const envPath = path.join(userDir, '.env');
        const personaPath = path.join(userDir, 'ai_persona.md');
        const envContent = `# 配置文件 (.env) - 修改后无需重启服务器，后端支持热加载\n# 你可以在这里填入一个或多个 万相台(DashScope) API Key。\n# 如果填写多个，请用英文逗号 \`,\` 隔开，系统会自动进行负载均衡（随机轮询）\n\nDASHSCOPE_API_KEYS=${config.apiKeys}`;
        fs.writeFileSync(envPath, envContent, 'utf8');
        fs.writeFileSync(personaPath, config.persona, 'utf8');
        return { success: true };
    } catch (e) {
        console.error("Error saving settings", e);
        return { success: false, error: e.message };
    }
});

ipcMain.handle('open-link', (event, url) => {
    shell.openExternal(url);
});

function createWindow() {
    ensureDefaults();
    startPythonBackend();

    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 1024,
        minHeight: 680,
        title: 'Scratch AI Assistant',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: true
        }
    });

    // 加载构建好的静态页面
    mainWindow.loadFile(path.join(__dirname, '..', 'build', 'index.html'));

    // 窗口错误捕获（否则生产环境可能变成死进程）
    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
        console.error('Failed to load:', errorCode, errorDescription);
    });

    // 解决 Scratch GUI 默认设置了 onbeforeunload 导致点击右上角关闭失效的问题
    mainWindow.webContents.on('will-prevent-unload', (event) => {
        // 阻止默认阻止行为，允许窗口直接关闭
        event.preventDefault();
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    // 设置应用菜单
    const template = [
        {
            label: '文件',
            submenu: [
                { label: '配置（API与人设）', click: openSettingsWindow },
                { type: 'separator' },
                { role: 'quit', label: '退出' }
            ]
        },
        {
            label: '编辑',
            submenu: [
                { role: 'undo', label: '撤销' },
                { role: 'redo', label: '恢复' },
                { type: 'separator' },
                { role: 'cut', label: '剪切' },
                { role: 'copy', label: '复制' },
                { role: 'paste', label: '粘贴' },
                { role: 'selectAll', label: '全选' }
            ]
        },
        {
            label: '视图',
            submenu: [
                { role: 'reload', label: '刷新' },
                { role: 'forceReload', label: '强制刷新' },
                { role: 'toggleDevTools', label: '开发者工具' },
                { type: 'separator' },
                { role: 'resetZoom', label: '重置缩放' },
                { role: 'zoomIn', label: '放大' },
                { role: 'zoomOut', label: '缩小' },
                { type: 'separator' },
                { role: 'togglefullscreen', label: '全屏' }
            ]
        },
        {
            label: '帮助',
            submenu: [
                {
                    label: '关于系统与核心模型',
                    click: () => {
                        const { dialog } = require('electron');
                        dialog.showMessageBox(mainWindow, {
                            type: 'info',
                            title: '关于 Socratic Scratch AI',
                            message: 'Socratic Scratch AI 智能教学助手',
                            detail: '🚀 开发者：陈虹宇 (北师大 BNU)\\n📧 邮箱：hychen@mail.bnu.edu.cn\\n\\n🤖 核心推理模型：本系统底层由【阿里通义千问 qwen3-max】大语言模型提供支撑。请确保您在“文件 -> 配置”中填入的 API Key 所属账号已开通该模型的权限。',
                            buttons: ['知道了']
                        });
                    }
                }
            ]
        }
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(createWindow);

app.on('will-quit', () => {
    if (pythonProcess) {
        if (process.platform === 'win32') {
            spawn('taskkill', ['/pid', pythonProcess.pid, '/f', '/t']);
        } else {
            pythonProcess.kill();
        }
        pythonProcess = null;
    }
});

app.on('window-all-closed', () => {
    app.quit();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});
