[🇨🇳 简体中文](README.md) | [🇺🇸 English](README_en.md)

# Scratch Socratic AI Assistant (智能学伴与代码编译器)

这是一个专为“少儿科技与编程教育”打造的**下一代图形化编程平台**。
平台不仅无缝内嵌了一套高度修改过的 Scratch 3.0 前端编辑器（带侧边栏悬浮窗），更在背后接入了“苏格拉底式”的大语言模型（LLM）教练，引导学生计算思维，还能将大模型编写的“自然伪代码”或“Markdown 代码块”在毫秒级编译成标准的 SB3 AST 结构树，实现积木**一键瞬发上板**！

## 核心架构设计

- `app.py`: 基于 Flask 的微服务核心总线。提供 `/api/chat` 和 `/api/compile_sb3_block` 接口。（端口 **5001**）
- `ai_persona.txt`: AI 学伴的大脑控制图谱。支持对 AI 发言字数、回复语气进行极端强制约束，**无需重启后端，实时即改即生效**！
- `scratch-gui/`: 基于官方 React 源码深度改良的前端项目，内部挂载了独家研发的 `AiChatSidebar` 防冲突积木流渲染器，以及 AST 结构后台静默预先装载引擎。。（端口 **8601**）

## ✨ 最近优化点 (Optimizations)

1. **AI Persona 持久化存储**: 将 AI 设定独立提取至 `ai_persona.md` 保存，且支持热更新，修改后即时生效。
2. **多端整合成独立程序**: 现支持利用 PyInstaller (Python 后端) 与 Electron (Node 前端) 将项目完整打包成 Windows 下免配置的独立一键运行包，便于极速分发。
3. **UI/UX 改进**: 优化了 `AiChatSidebar` 的视觉呈现样式 (CSS) 以及状态逻辑。

---

## 🛠️ 安装与拉取项目

打开你的控制台，执行：
```bash
git clone https://github.com/nijisakai/scratch_ai_assistant.git
cd scratch_ai_assistant
```

---

## 🚀 步骤一：启动 AI 微服务后端 (Python)

这是必须最先启动的微枢纽服务，处理智能对话与 AST 编译。

1. **安装环境依赖**:
```bash
pip install flask flask-cors dashscope python-dotenv
```

2. **环境变量与运行** (请根据情况绑定您的大模型 API 密钥):
```bash
# 视具体代码逻辑，如有环境变量如 DASHSCOPE_API_KEY，可以在前置声明。
python app.py
```
> **看到 `🚀 Scratch AI 编程助手 - 后端启动运行于端口 5001` 则表示成功。**

---

## 🚀 步骤二：启动 Scratch GUI 图形化前端 (Node + React)

在保持上面 Python 后端运行的同时，**新开一个终端窗口**，进入子目录 `scratch-gui`：

1. **安装 NPM 包** (由于官方依赖庞大，首次运行需较长时间):
```bash
cd scratch-gui
npm install
```

2. **开启热更服务**:
```bash
npm start
```
应用启动后，打开浏览器访问 **`http://localhost:8601`** 即可开启全新的智能 AI 创作之旅啦！🌟

---

## 📚 引用须知 (Citation)

如果您在您的研究、论文或落地项目中使用了本项目，请引用或注明出处：
> 陈虹宇 (Beijing Normal University). Scratch Socratic AI Assistant. GitHub: https://github.com/nijisakai/scratch_ai_assistant

## 📝 作者与联系方式 (Author & Contact)

- **作者 (Author)**: 陈虹宇 (BNU)
- **邮箱 (Email)**: hychen@mail.bnu.edu.cn
