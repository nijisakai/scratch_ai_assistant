import React from 'react';
import classNames from 'classnames';
import styles from './ai-chat.css';

class AiChatSidebar extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            isOpen: true,
            messages: [{ role: 'ai', content: '✨ 小朋友你好！我是你的专属编程学伴。你有什么天马行空的创意呢？快告诉我，我帮你把积木拼出来！' }],
            inputValue: '',
            isGenerating: false,
            isDragging: false,
            position: null,
            dragStartPos: null,
            loadingBlockIdx: null,
            preloadedBlocks: {}
        };
        this.messagesEndRef = React.createRef();
        this.chatContainerRef = React.createRef();
    }

    componentDidMount() {
        if (!window.scratchblocks) {
            const script = document.createElement('script');
            script.src = "https://cdn.jsdelivr.net/npm/scratchblocks@3.6.4/build/scratchblocks.min.js";
            script.onload = () => {
                const script2 = document.createElement('script');
                script2.src = "https://cdn.jsdelivr.net/npm/scratchblocks@3.6.4/build/translations-all.js";
                script2.onload = () => {
                    this.renderScratchBlocks();
                };
                document.head.appendChild(script2);
            };
            document.head.appendChild(script);
        } else {
            this.renderScratchBlocks();
        }
    }

    componentDidUpdate() {
        this.scrollToBottom();
        this.renderScratchBlocks();
    }

    scrollToBottom = () => {
        if (this.messagesEndRef.current) {
            this.messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    };

    handleMouseDown = (e) => {
        if (e.target.closest('.chatToggleContainer')) return;

        let currentX = 0;
        let currentY = 0;
        if (this.state.position) {
            currentX = this.state.position.x;
            currentY = this.state.position.y;
        } else if (this.chatContainerRef.current) {
            const rect = this.chatContainerRef.current.getBoundingClientRect();
            currentX = rect.left;
            currentY = rect.top;
        }

        this.setState({
            isDragging: true,
            position: { x: currentX, y: currentY },
            dragStartPos: { 
                x: e.clientX - currentX, 
                y: e.clientY - currentY 
            }
        });
        document.addEventListener('mousemove', this.handleMouseMove);
        document.addEventListener('mouseup', this.handleMouseUp);
    };

    handleMouseMove = (e) => {
        if (!this.state.isDragging) return;
        this.setState({
            position: {
                x: e.clientX - this.state.dragStartPos.x,
                y: e.clientY - this.state.dragStartPos.y
            }
        });
    };

    handleMouseUp = () => {
        this.setState({ isDragging: false });
        document.removeEventListener('mousemove', this.handleMouseMove);
        document.removeEventListener('mouseup', this.handleMouseUp);
    };

    renderScratchBlocks = () => {
        if (this.chatContainerRef.current && window.scratchblocks) {
            try {
                // Defensively add languages only if the asynchronous translations script has finished loading
                const langs = ['en'];
                if (window.scratchblocks.allLanguages) {
                    if (window.scratchblocks.allLanguages['zh-cn']) langs.push('zh-cn');
                    if (window.scratchblocks.allLanguages['zh_CN']) langs.push('zh_CN');
                }
                
                // Safely ask library to parse and render without destroying React's expectations!
                const codeElements = this.chatContainerRef.current.querySelectorAll('code.language-scratch');
                codeElements.forEach(el => {
                    const currentCode = el.getAttribute('data-original-code');
                    if (!currentCode || el.getAttribute('data-rendered-code') === currentCode) {
                        return; // Target has already been fully resolved into SVG or lacks data
                    }
                    else {
                        const parsed = window.scratchblocks.parse(currentCode, { languages: langs });
                        const svg = window.scratchblocks.render(parsed, { style: 'scratch3' });
                        el.innerHTML = '';
                        el.appendChild(svg);
                        el.setAttribute('data-rendered-code', currentCode);
                    }
                });
            } catch (e) {
                console.warn('Scratchblocks render issue:', e);
            }
        }
    };

    preloadAST = async (messageIdx, content) => {
        const parts = content.split(/```scratch([\s\S]*?)(?:```|$)/g);
        for (let idx = 0; idx < parts.length; idx++) {
            if (idx % 2 === 1) { // block text array index
                const cleanBlockTxt = parts[idx].trim();
                if (!cleanBlockTxt || cleanBlockTxt.length < 5) continue;
                if (/^[\.\s…]*$/.test(cleanBlockTxt)) continue;
                
                const cacheKey = `${messageIdx}-${idx}`;
                try {
                    const response = await fetch('http://127.0.0.1:5001/api/compile_sb3_block', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ block_text: cleanBlockTxt })
                    });
                    const result = await response.json();
                    if (response.ok && result.status === 'success') {
                        this.setState(prevState => ({
                            preloadedBlocks: {
                                ...(prevState.preloadedBlocks || {}),
                                [cacheKey]: result.blocks
                            }
                        }));
                        console.log('⚡ AST Preloaded implicitly for block:', cacheKey);
                    }
                } catch (err) {
                    console.warn('Silent AST preload failed for', cacheKey, err);
                }
            }
        }
    };

    handleToggle = () => {
        this.setState((prevState) => ({ isOpen: !prevState.isOpen }));
    };

    handleInputChange = (e) => {
        this.setState({ inputValue: e.target.value });
    };

    handleKeyPress = (e) => {
        if (e.key === 'Enter' && !this.state.isGenerating) {
            this.handleSend();
        }
    };

    handleSend = async () => {
        const { inputValue, messages } = this.state;
        if (!inputValue.trim()) return;

        const newUserMessage = { role: 'user', content: inputValue };
        this.setState({
            messages: [...messages, newUserMessage, { role: 'ai', content: '', isTyping: true }],
            inputValue: '',
            isGenerating: true
        });

        const chatHistoryForAPI = [...messages, newUserMessage].map(m => ({
            role: m.role === 'ai' ? 'assistant' : 'user',
            content: m.content
        })).filter(m => !m.content.includes("isTyping")); // Remove temporary typing states

        try {
            const response = await fetch('http://127.0.0.1:5001/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages: chatHistoryForAPI })
            });

            if (!response.ok) {
                throw new Error('Network response was not ok');
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let fullAiResponse = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split('\n');
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const dataStr = line.replace('data: ', '');
                        if (dataStr === '[DONE]') break;
                        try {
                            const dataObj = JSON.parse(dataStr);
                            if (dataObj.error) {
                                fullAiResponse += `\n[大模型 API 报错]: ${dataObj.error}`;
                            } else if (dataObj.content !== undefined) {
                                fullAiResponse += dataObj.content;
                            }
                            
                            this.setState(prevState => {
                                const newMessages = [...prevState.messages];
                                newMessages[newMessages.length - 1] = {
                                    role: 'ai',
                                    content: fullAiResponse,
                                    isTyping: true
                                };
                                return { messages: newMessages };
                            });
                        } catch (e) {
                            console.error('SSE JSON parsing error', e);
                        }
                    }
                }
            }

            // Finish typing
            this.setState(prevState => {
                const newMessages = [...prevState.messages];
                newMessages[newMessages.length - 1].isTyping = false;
                return { 
                    messages: newMessages,
                    isGenerating: false 
                };
            }, () => {
                // Background preload AST
                this.preloadAST(this.state.messages.length - 1, fullAiResponse);
            });

        } catch (error) {
            console.error('Chat error:', error);
            this.setState(prevState => {
                const newMessages = [...prevState.messages];
                newMessages[newMessages.length - 1] = {
                    role: 'ai',
                    content: '❌ API 连接失败或跨域错误，请检查 5001 端口微服务是否运行！',
                    isTyping: false
                };
                return { messages: newMessages, isGenerating: false };
            });
        }
    };

    handleInjectBlock = async (blockText, messageIdx, blockIdx) => {
        if (!this.props.vm || !this.props.vm.editingTarget) {
            alert('请先在左侧选择一个能够接收积木的角色（小猫）！');
            return;
        }

        const cacheKey = `${messageIdx}-${blockIdx}`;
        this.setState({ loadingBlockIdx: cacheKey });

        let rawBlocks = null;
        
        // Fast path: use preloaded JSON AST!
        if (this.state.preloadedBlocks && this.state.preloadedBlocks[cacheKey]) {
            rawBlocks = this.state.preloadedBlocks[cacheKey];
            console.log('✅ Found PRELOADED AST for block injection!');
        } else {
            // Slow path: Ask LLM compilation service if preload isn't ready
            console.log(`[Frontend DEBUG] Fallback to Compiler, length: ${blockText.length}`);
            try {
                const response = await fetch('http://127.0.0.1:5001/api/compile_sb3_block', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ block_text: blockText })
                });

                const result = await response.json();
                if (response.ok && result.status === 'success') {
                    rawBlocks = result.blocks;
                } else {
                    alert(`编译积木失败：${result.error}`);
                    this.setState({ loadingBlockIdx: null });
                    return;
                }
            } catch (err) {
                alert(`连线微服务编译报错：${err.message}`);
                this.setState({ loadingBlockIdx: null });
                return;
            }
        }
            
        if (!rawBlocks || rawBlocks.length === 0) {
            alert('AI 生成的积木为空！');
            this.setState({ loadingBlockIdx: null });
            return;
        }

                // 防呆处理 1：重写 block ID 以避免同名积木二次加载被忽略
                const uidSuffix = '_' + Math.random().toString(36).substr(2, 6);
                const idMap = {};
                rawBlocks.forEach(b => { idMap[b.id] = b.id + uidSuffix; });

                const blocksArray = rawBlocks.map(b => {
                    const newB = { ...b, id: idMap[b.id] };
                    if (newB.next && idMap[newB.next]) newB.next = idMap[newB.next];
                    if (newB.parent && idMap[newB.parent]) newB.parent = idMap[newB.parent];
                    
                    if (newB.inputs) {
                        const newInputs = {};
                        for (const inputKey in newB.inputs) {
                            const inputVal = newB.inputs[inputKey];
                            const clonedInput = JSON.parse(JSON.stringify(inputVal));
                            if (Array.isArray(clonedInput) && clonedInput.length >= 2) {
                                if (typeof clonedInput[1] === 'string' && idMap[clonedInput[1]]) {
                                    clonedInput[1] = idMap[clonedInput[1]];
                                }
                            }
                            newInputs[inputKey] = clonedInput;
                        }
                        newB.inputs = newInputs;
                    }
                    return newB;
                });

                // 防呆处理 2：强制分配根节点和视窗坐标，防止由于 AI 少生成字段导致渲染隐形
                blocksArray[0].topLevel = true;
                blocksArray[0].parent = null;
                blocksArray[0].x = 100 + Math.floor(Math.random() * 100);
                blocksArray[0].y = 100 + Math.floor(Math.random() * 100);

                await this.props.vm.shareBlocksToTarget(blocksArray, this.props.vm.editingTarget.id);
                this.props.vm.emitWorkspaceUpdate(); // 强制刷新画布
                console.log('✅ AST Blocks Injected natively with safe salting!');

        this.setState({ loadingBlockIdx: null });
    };

    // 简易 Markdown / Scratchblocks 解析器
    renderMessageContent = (content, messageIdx) => {
        // 利用正则表达式切分 ```scratch 和 ``` 中间的部分，并兼容未闭合的块（使其能实时流入渲染）
        const parts = content.split(/```scratch([\s\S]*?)(?:```|$)/g);
        
        return parts.map((part, idx) => {
            if (idx % 2 === 1) { // 奇数索引为抓取到的组别，也就是 scratchblocks 语法
                const cleanBlockTxt = part.trim();
                const blockIdx = idx;
                const isLoading = this.state.loadingBlockIdx === `${messageIdx}-${blockIdx}`;
                
                // 判断是否是只有省略号或空行（AI用来做教学提示的占位符）
                const isHintBlock = /^[\.\s…]*$/.test(cleanBlockTxt);

                return (
                    <div key={idx} className={styles.blockContainer}>
                        <div className={styles.scratchBlockPreview}>
                            <pre className="blocks" style={{ margin: 0 }}>
                                <code 
                                    className="language-scratch" 
                                    data-original-code={cleanBlockTxt}
                                    dangerouslySetInnerHTML={{ __html: cleanBlockTxt }}
                                ></code>
                            </pre>
                        </div>
                        {!isHintBlock && (
                            <button
                                className={classNames(styles.injectButton, {
                                    [styles.loading]: isLoading
                                })}
                                onClick={() => this.handleInjectBlock(cleanBlockTxt, messageIdx, blockIdx)}
                                disabled={isLoading}
                            >
                                {isLoading ? '正在生成底层代码...' : '🚀 加载到选中角色代码区'}
                            </button>
                        )}
                    </div>
                );
            } else { // 偶数索引是普通文本
                return (
                    <span key={idx} style={{whiteSpace: 'pre-wrap'}}>
                        {part}
                    </span>
                );
            }
        });
    };

    render() {
        const { isOpen, messages, inputValue, isGenerating } = this.state;

        return (
            <React.Fragment>
                {!isOpen && (
                    <div 
                        className={styles.floatingToggle} 
                        onClick={this.handleToggle}
                        title="唤醒 AI 编程导师"
                        style={this.state.position ? { left: this.state.position.x, top: this.state.position.y } : {}}
                    >
                        🤖
                    </div>
                )}
                {isOpen && (
                    <div 
                        className={classNames(styles.chatContainer, { [styles.collapsed]: !isOpen })} 
                        ref={this.chatContainerRef}
                        style={this.state.position ? { left: this.state.position.x, top: this.state.position.y, bottom: 'auto', right: 'auto', margin: 0 } : {}}
                    >
                        <div className={styles.chatHeader} title="点我拖拽" onMouseDown={this.handleMouseDown} style={{cursor: 'move'}}>
                            <span style={{ fontSize: '18px' }}>🤖 Socratic Scratch AI</span>
                            <div className="chatToggleContainer">
                                <button className={styles.chatToggle} onClick={this.handleToggle} style={{cursor: 'pointer'}}>×</button>
                            </div>
                        </div>
                        
                        <div className={styles.chatMessages}>
                        {messages.map((msg, idx) => (
                            <div key={idx} className={classNames(styles.message, {
                                [styles.userMessage]: msg.role === 'user',
                                [styles.aiMessage]: msg.role === 'ai'
                            })}>
                                {this.renderMessageContent(msg.content, idx)}
                                {msg.isTyping && <span style={{marginLeft: 5}}>▌</span>}
                            </div>
                        ))}
                        <div ref={this.messagesEndRef} />
                    </div>

                    <div className={styles.inputContainer}>
                        <input 
                            type="text" 
                            className={styles.chatInput} 
                            placeholder="输入您的想要做的游戏或想法..." 
                            value={inputValue}
                            onChange={this.handleInputChange}
                            onKeyPress={this.handleKeyPress}
                            disabled={isGenerating}
                        />
                        <button 
                            className={styles.sendButton} 
                            onClick={this.handleSend}
                            disabled={!inputValue.trim() || isGenerating}
                        >
                            {isGenerating ? '...' : '发送'}
                        </button>
                    </div>
                    </div>
                )}
            </React.Fragment>
        );
    }
}

export default AiChatSidebar;
