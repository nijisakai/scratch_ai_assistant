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
            hasDragged: false,
            position: null,
            dragStartPos: null,
            loadingBlockIdx: null,
            preloadedBlocks: {},
            zoom: 1.0,
            suggestions: [
                '教我写一个贪吃蛇游戏！',
                '老师，怎么让小猫跟着鼠标移动？',
                '我不懂变量是什么，能解释一下吗？'
            ]
        };
        this.messagesEndRef = React.createRef();
        this.chatContainerRef = React.createRef();
        this.astPromises = {};
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

    componentDidUpdate(prevProps, prevState) {
        if (prevState.messages !== this.state.messages && this.state.isGenerating) {
            this.scrollToBottom();
        }
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
        } else {
            const rect = e.currentTarget.getBoundingClientRect();
            currentX = rect.left;
            currentY = rect.top;
        }

        this.setState({
            isDragging: true,
            hasDragged: false,
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
            hasDragged: true,
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

    preloadSingleAST = async (messageIdx, blockIdx, cleanBlockTxt) => {
        const cacheKey = `${messageIdx}-${blockIdx}`;
        if (this.astPromises[cacheKey]) return this.astPromises[cacheKey];
        
        const fetchPromise = fetch('http://127.0.0.1:5001/api/compile_sb3_block', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ block_text: cleanBlockTxt })
        })
        .then(response => response.json())
        .then(result => {
            if (result.status === 'success') {
                this.setState(prevState => ({
                    preloadedBlocks: {
                        ...(prevState.preloadedBlocks || {}),
                        [cacheKey]: result.blocks
                    }
                }));
                console.log('⚡ AST 管道提速预处理完成:', cacheKey);
                return result.blocks;
            }
            throw new Error(result.error);
        })
        .catch(err => {
            console.warn('Silent AST preload failed for', cacheKey, err);
            return null;
        });

        this.astPromises[cacheKey] = fetchPromise;
        return fetchPromise;
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

    handleSend = async (overrideText) => {
        const isString = typeof overrideText === 'string';
        const textToSend = isString ? overrideText : this.state.inputValue;
        if (!textToSend.trim()) return;

        const newUserMessage = { role: 'user', content: textToSend };
        this.setState({
            messages: [...this.state.messages, newUserMessage, { role: 'ai', content: '', isTyping: true }],
            inputValue: '',
            isGenerating: true,
            suggestions: []
        });

        const chatHistoryForAPI = [...this.state.messages, newUserMessage].map(m => ({
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
            let parsedBlockCount = 0;
            const currentMsgIdx = this.state.messages.length - 1;

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
                                
                                // 在流式输出过程中捕捉闭合的积木，实现无感预加载！
                                const blockMatches = [...fullAiResponse.matchAll(/```scratch([\s\S]*?)```/g)];
                                if (blockMatches.length > parsedBlockCount) {
                                    const latestBlockTxt = blockMatches[parsedBlockCount][1].trim();
                                    const domIdx = parsedBlockCount * 2 + 1;
                                    parsedBlockCount++;
                                    
                                    if (latestBlockTxt && latestBlockTxt.length >= 5 && !/^[\.\s…]*$/.test(latestBlockTxt)) {
                                        this.preloadSingleAST(currentMsgIdx, domIdx, latestBlockTxt);
                                    }
                                }
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
                // Post-stream fallback check for unclosed or remaining blocks
                const finalParts = fullAiResponse.split(/```scratch([\s\S]*?)(?:```|$)/g);
                for (let idx = 0; idx < finalParts.length; idx++) {
                    if (idx % 2 === 1) { 
                        const cleanBlockTxt = finalParts[idx].trim();
                        if (cleanBlockTxt && cleanBlockTxt.length >= 5 && !/^[\.\s…]*$/.test(cleanBlockTxt)) {
                            this.preloadSingleAST(currentMsgIdx, idx, cleanBlockTxt);
                        }
                    }
                }
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
        } else if (this.astPromises && this.astPromises[cacheKey]) {
            console.log('⏳ Awaiting already flying AST compilation...');
            rawBlocks = await this.astPromises[cacheKey];
        } else {
            // Slow path (fallback): Ask LLM compilation service if preload isn't ready
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

        const resolveVarId = (varName, fieldKey) => {
            let varType = '';
            if (fieldKey === 'LIST') varType = 'list';
            if (fieldKey === 'BROADCAST_OPTION') varType = 'broadcast_msg';
            
            const t = this.props.vm.editingTarget;
            const s = this.props.vm.runtime.getTargetForStage();
            let foundId = null;
            [t, s].forEach(target => {
                if (target && target.variables && !foundId) {
                    for (const vid in target.variables) {
                        const v = target.variables[vid];
                        if (v.name === varName && (v.type === varType || (varType === '' && (!v.type || v.type === '')))) {
                            foundId = vid;
                        }
                    }
                }
            });
            if (foundId) return foundId;
            
            // 自动补齐缺失的变量定义到 VM 中，避免因为缺少上下文导致积木交互假死！
            const newId = 'var_' + varType + '_' + Math.random().toString(36).substr(2, 6);
            if (t && typeof t.createVariable === 'function') {
                t.createVariable(newId, varName, varType, false);
            }
            return newId;
        };

        // 【应急解毒剂】：深度清洗上一次因为 React HMR(热重载) 遗留在 Scratch 虚拟机全局内存里的“毒变量”
        // 防止之前错误写入的纯 JSON 对象触发 `v.toXML is not a function` 画布崩溃链
        const targetList = [this.props.vm.editingTarget, this.props.vm.runtime.getTargetForStage()];
        targetList.forEach(target => {
            if (target && target.variables) {
                for (const vid in target.variables) {
                    const v = target.variables[vid];
                    if (v && typeof v.toXML !== 'function') {
                        v.toXML = function(isLocal) {
                            const escape = str => str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
                            return `<variable type="${this.type || ''}" id="${this.id}" islocal="${isLocal === true}" iscloud="${this.isCloud}">${escape(this.name || '')}</variable>`;
                        };
                        console.warn('🩺 成功解救一个被毒害的系统变量:', v.name);
                    }
                }
            }
        });

                // 防呆处理 1：重写 block ID 以避免同名积木二次加载被忽略
                const uidSuffix = '_' + Math.random().toString(36).substr(2, 6);
                const idMap = {};
                rawBlocks.forEach(b => { idMap[b.id] = b.id + uidSuffix; });

                const blocksArray = [];
                // 第一个 pass: 将原始积木的常规属性处理完毕
                rawBlocks.forEach(b => {
                    const newB = { ...b, id: idMap[b.id] };
                    if (newB.next && idMap[newB.next]) newB.next = idMap[newB.next];
                    if (newB.parent && idMap[newB.parent]) newB.parent = idMap[newB.parent];
                    
                    if (!newB.fields) newB.fields = {};

                    // 防呆处理 1.5：兜底关键的 Hat Block Fields (防止引擎尝试读属性时因为undefined导致运行时崩溃)
                    if (newB.opcode === 'event_whenkeypressed' && !newB.fields.KEY_OPTION) {
                        newB.fields.KEY_OPTION = ["space", null];
                    } else if (newB.opcode === 'event_whenbroadcastreceived' && !newB.fields.BROADCAST_OPTION) {
                        newB.fields.BROADCAST_OPTION = ["message1", "message1"];
                    } else if (newB.opcode === 'event_whenbackdropswitchesto' && !newB.fields.BACKDROP) {
                        newB.fields.BACKDROP = ["backdrop1", null];
                    } else if (newB.opcode === 'event_whengreaterthan' && !newB.fields.WHENGREATERTHANMENU) {
                        newB.fields.WHENGREATERTHANMENU = ["LOUDNESS", null];
                    }

                    // 转换 Fields 格式： [ "value", "id" ] => { name: "xx", value: "xx" }
                    if (newB.fields) {
                        const newFields = {};
                        for (const fieldKey in newB.fields) {
                            const fieldVal = newB.fields[fieldKey];
                            if (Array.isArray(fieldVal)) {
                                const valName = fieldVal[0];
                                newFields[fieldKey] = { name: fieldKey, value: valName };
                                if (['VARIABLE', 'LIST', 'BROADCAST_OPTION'].includes(fieldKey)) {
                                    newFields[fieldKey].id = resolveVarId(valName, fieldKey);
                                } else if (fieldVal.length > 1 && fieldVal[1]) {
                                    newFields[fieldKey].id = fieldVal[1];
                                }
                            } else if (typeof fieldVal === 'string' || typeof fieldVal === 'number') {
                                // 容错处理：如果大模型暴力塞入了原始字面量（而非标准的带 ID 的数组），自动兼容转换
                                const valName = String(fieldVal);
                                newFields[fieldKey] = { name: fieldKey, value: valName };
                                if (['VARIABLE', 'LIST', 'BROADCAST_OPTION'].includes(fieldKey)) {
                                    newFields[fieldKey].id = resolveVarId(valName, fieldKey);
                                }
                            } else {
                                newFields[fieldKey] = fieldVal; // 若大模型已写出合法对象结构，则保持原样
                            }
                        }
                        newB.fields = newFields;
                    }
                    blocksArray.push(newB);
                });

                // 第二个 pass: 转换 Inputs 格式
                // 从 SB3 (如 [1, [4, "10"]]) 转置到内存里的 AST ({name, block, shadow})
                const extraShadowBlocks = [];
                blocksArray.forEach(newB => {
                    if (newB.inputs) {
                        const newInputs = {};
                        for (const inputKey in newB.inputs) {
                            const inputVal = newB.inputs[inputKey];
                            if (Array.isArray(inputVal)) {
                                let blockId = null;
                                let shadowId = null;
                                const shadowType = inputVal[0];
                                
                                let overrideMenu = false;
                                const menuTypes = {
                                    'KEY_OPTION': { opcode: 'sensing_keyoptions', field: 'KEY_OPTION' },
                                    'COSTUME': { opcode: 'looks_costume', field: 'COSTUME' },
                                    'BACKDROP': { opcode: 'looks_backdrops', field: 'BACKDROP' },
                                    'SOUND_MENU': { opcode: 'sound_sounds_menu', field: 'SOUND_MENU' },
                                    'TOUCHINGOBJECTMENU': { opcode: 'sensing_touchingobjectmenu', field: 'TOUCHINGOBJECTMENU' },
                                    'TO': { opcode: newB.opcode === 'motion_glideto' ? 'motion_glideto_menu' : 'motion_goto_menu', field: 'TO' },
                                    'TOWARDS': { opcode: 'motion_pointtowards_menu', field: 'TOWARDS' },
                                    'DISTANCETOMENU': { opcode: 'sensing_distancetomenu', field: 'DISTANCETOMENU' },
                                    'OBJECT': { opcode: 'sensing_of_object_menu', field: 'OBJECT' },
                                    'CLONE_OPTION': { opcode: 'control_create_clone_of_menu', field: 'CLONE_OPTION' }
                                };

                                if (shadowType === 1 && menuTypes[inputKey]) {
                                    let menuVal = "";
                                    const extracted = inputVal[1];
                                    if (typeof extracted === 'string') {
                                        menuVal = extracted;
                                    } else if (Array.isArray(extracted)) {
                                        // 智能剥离数组壳，不管是 [10, "mouse-pointer"] 还是 ["mouse-pointer", null] 都能抓取真值
                                        const strItem = extracted.find(v => typeof v === 'string' && v.trim() !== '');
                                        menuVal = strItem !== undefined ? strItem : String(extracted[1] || extracted[0]);
                                    } else {
                                        menuVal = String(extracted);
                                    }

                                    // 将人话（大模型输出的文本）翻译成底层无情的系统枚举符号
                                    const enumMap = {
                                        'mouse-pointer': '_mouse_',
                                        'random position': '_random_',
                                        'random pos': '_random_',
                                        'edge': '_edge_',
                                        'myself': '_myself_',
                                        'Stage': '_stage_',
                                        'stage': '_stage_',
                                        'all around': 'all around', 
                                        'left-right': 'left-right', 
                                        "don't rotate": "don't rotate"
                                    };
                                    // 容错处理: 去除多余空格和强制小写（特殊键除外）
                                    const safeVal = String(menuVal).trim();
                                    if (enumMap[safeVal]) menuVal = enumMap[safeVal];
                                    else if (enumMap[safeVal.toLowerCase()]) menuVal = enumMap[safeVal.toLowerCase()];
                                    else if (safeVal === '_mouse_' || safeVal === '_random_' || safeVal === '_edge_' || safeVal === '_myself_' || safeVal === '_stage_') menuVal = safeVal;

                                    if (!idMap[menuVal]) { // If it's not a real linked block ID
                                        const inlineId = 'shadow_' + uidSuffix + '_menu_' + Math.random().toString(36).substr(2, 6);
                                        const primBlock = {
                                            id: inlineId, opcode: menuTypes[inputKey].opcode, inputs: {},
                                            fields: {}, next: null, parent: newB.id,
                                            shadow: true, topLevel: false
                                        };
                                        primBlock.fields[menuTypes[inputKey].field] = { name: menuTypes[inputKey].field, value: menuVal };
                                        extraShadowBlocks.push(primBlock);
                                        blockId = inlineId; shadowId = inlineId;
                                        overrideMenu = true;
                                    }
                                }
                                
                                if (!overrideMenu) {
                                    if (shadowType === 1) { // INPUT_SAME_BLOCK_SHADOW
                                        if (Array.isArray(inputVal[1])) {
                                            // 这里嵌套了基础变量，例如 [4, "10"] 或 [10, "hello"]。必须凭空切一个 shadow block 出来。
                                            const inlineId = 'shadow_' + uidSuffix + '_' + Math.random().toString(36).substr(2, 6);
                                            const opcodeMap = {4: 'math_number', 5: 'math_positive_number', 6: 'math_whole_number', 7: 'math_integer', 8: 'math_angle', 9: 'colour_picker', 10: 'text', 11: 'event_broadcast_menu', 12: 'data_variable', 13: 'data_listcontents'};
                                            const fieldMap = {4: 'NUM', 5: 'NUM', 6: 'NUM', 7: 'NUM', 8: 'NUM', 9: 'COLOUR', 10: 'TEXT', 11: 'BROADCAST_OPTION', 12: 'VARIABLE', 13: 'LIST'};
                                            
                                            const primOpcode = opcodeMap[inputVal[1][0]];
                                            const primField = fieldMap[inputVal[1][0]];
                                            if (primOpcode) {
                                                const primBlock = {
                                                    id: inlineId, opcode: primOpcode, inputs: {},
                                                    fields: {}, next: null, parent: newB.id,
                                                    shadow: true, topLevel: false
                                                };
                                                primBlock.fields[primField] = { name: primField, value: inputVal[1][1] };
                                                if (['VARIABLE', 'LIST', 'BROADCAST_OPTION'].includes(primField)) {
                                                    primBlock.fields[primField].id = resolveVarId(inputVal[1][1], primField);
                                                }
                                                extraShadowBlocks.push(primBlock);
                                                blockId = inlineId; shadowId = inlineId;
                                            }
                                        } else {
                                            blockId = (typeof inputVal[1] === 'string' && idMap[inputVal[1]]) ? idMap[inputVal[1]] : inputVal[1];
                                            shadowId = blockId;
                                        }
                                    } else if (shadowType === 2) { // INPUT_BLOCK_NO_SHADOW
                                        blockId = (typeof inputVal[1] === 'string' && idMap[inputVal[1]]) ? idMap[inputVal[1]] : inputVal[1];
                                        shadowId = null;
                                    } else if (shadowType === 3) { // INPUT_DIFF_BLOCK_SHADOW
                                        blockId = (typeof inputVal[1] === 'string' && idMap[inputVal[1]]) ? idMap[inputVal[1]] : inputVal[1];
                                        shadowId = (typeof inputVal[2] === 'string' && idMap[inputVal[2]]) ? idMap[inputVal[2]] : inputVal[2];
                                    }
                                }

                                newInputs[inputKey] = { name: inputKey, block: blockId, shadow: shadowId };
                            } else {
                                newInputs[inputKey] = inputVal;
                            }
                        }
                        newB.inputs = newInputs;
                    }
                });
                
                // 将拆解的内嵌 shadow 块也挂到载入池里
                blocksArray.push(...extraShadowBlocks);

                // 防呆处理 2：强制分配根节点和视窗坐标，防止由于 AI 少生成字段导致渲染隐形
                // 支持大模型一次性生成多个完全独立的脚本（也就是多个大根节点）
                let currentY = 50 + Math.floor(Math.random() * 400);
                const baseX = 50 + Math.floor(Math.random() * 300);
                blocksArray.forEach(b => {
                    if (!b.parent) {
                        b.topLevel = true;
                        b.x = baseX;
                        b.y = currentY;
                        currentY += 150; // 下移，避免多段代码重叠
                    } else {
                        b.topLevel = false; // 按原版逻辑清理非根节点
                    }
                });

                // 第三步: 图结构防呆检查 (AST Cycle Breaker)
                // 确保大模型没有把循环体底部积木的 next 错误地指回父级节点，形成破坏 Webpack 渲染栈的无限死循环
                const buildAdjacencyList = () => {
                    const adj = {};
                    blocksArray.forEach(b => {
                        const children = [];
                        if (b.next) children.push({ type: 'next', id: b.next });
                        if (b.inputs) {
                            for (const key in b.inputs) {
                                const ptr = b.inputs[key];
                                if (ptr && ptr.block) children.push({ type: 'input', key, id: ptr.block });
                                if (ptr && ptr.shadow && ptr.shadow !== ptr.block) children.push({ type: 'shadow', key, id: ptr.shadow });
                            }
                        }
                        adj[b.id] = children;
                    });
                    return adj;
                };

                const adj = buildAdjacencyList();
                const visited = new Set();
                const recursionStack = new Set();

                const dfsBreakCycles = (nodeId) => {
                    if (!nodeId) return;
                    const strNodeId = String(nodeId);
                    if (!idMap[strNodeId.replace(uidSuffix, '')] && !strNodeId.startsWith('shadow_')) return;
                    if (recursionStack.has(strNodeId)) return true; // Found a cycle!
                    if (visited.has(strNodeId)) return false;

                    visited.add(strNodeId);
                    recursionStack.add(strNodeId);

                    const children = adj[strNodeId] || [];
                    for (const child of children) {
                        const hasCycle = dfsBreakCycles(child.id);
                        if (hasCycle) {
                            console.warn(`AST Cycle Breaker: 断开了危险的无限循环引用 ${strNodeId} -> ${String(child.id)}`);
                            const blockItem = blocksArray.find(x => x.id === strNodeId);
                            if (blockItem) {
                                if (child.type === 'next') blockItem.next = null;
                                else if (child.type === 'input') blockItem.inputs[child.key].block = null;
                                else if (child.type === 'shadow') blockItem.inputs[child.key].shadow = null;
                            }
                        }
                    }
                    recursionStack.delete(strNodeId);
                    return false;
                };

                blocksArray.filter(b => b.topLevel).forEach(b => dfsBreakCycles(b.id));

                // 第四步：清理悬空指针 (Dangling Pointers Fixer)
                // 任何指向不存在的 id 的 next/parent，必须强制置空，防止 Blockly 引擎渲染崩溃导致工作区原积木全部消失
                const validIds = new Set(blocksArray.map(b => String(b.id)));
                blocksArray.forEach(b => {
                    if (b.next && !validIds.has(String(b.next))) {
                        console.warn('AST Guard: Fixing dangling next pointer', b.next);
                        b.next = null;
                    }
                    if (b.parent && !validIds.has(String(b.parent))) {
                        console.warn('AST Guard: Fixing dangling parent pointer', b.parent);
                        b.parent = null;
                        b.topLevel = true;
                    }
                    if (b.inputs) {
                        for (const key in b.inputs) {
                            const ptr = b.inputs[key];
                            if (ptr && ptr.block && !validIds.has(String(ptr.block))) {
                                console.warn('AST Guard: Fixing dangling input pointer', ptr.block);
                                ptr.block = null;
                            }
                            if (ptr && ptr.shadow && !validIds.has(String(ptr.shadow))) {
                                ptr.shadow = null;
                            }
                        }
                    }
                });

                try {
                    await this.props.vm.shareBlocksToTarget(blocksArray, this.props.vm.editingTarget.id);
                    this.props.vm.emitWorkspaceUpdate(); // 强制刷新画布
                    console.log('✅ AST Blocks Injected natively with safe salting!');
                } catch (e) {
                    console.error("Injection failed:", e);
                }

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
        const { isOpen, messages, inputValue, isGenerating, zoom, suggestions } = this.state;

        let displayMessages = messages.map(msg => ({...msg}));
        let currentSuggestions = [...suggestions];
        
        displayMessages.forEach((msg, idx) => {
            if (msg.role === 'ai') {
                const suggMatch = msg.content.match(/\[SUGGESTIONS\]([\s\S]*?)(?:\[\/SUGGESTIONS\]|$)/);
                if (suggMatch) {
                    if (idx === displayMessages.length - 1 && !msg.isTyping) {
                        currentSuggestions = suggMatch[1].split('\n')
                            .map(s => s.replace(/^\d+\.\s*/, '').trim())
                            .filter(s => s.length > 0);
                    }
                    msg.content = msg.content.replace(/\[SUGGESTIONS\][\s\S]*?(?:\[\/SUGGESTIONS\]|$)/, '');
                } else if (msg.isTyping && idx === displayMessages.length - 1) {
                    const tempSuggMatch = msg.content.match(/\[SUGGESTIONS\]([\s\S]*)$/);
                    if (tempSuggMatch) {
                        msg.content = msg.content.replace(/\[SUGGESTIONS\][\s\S]*$/, '');
                    }
                }
            }
        });

        return (
            <React.Fragment>
                {!isOpen && (
                    <div 
                        className={styles.floatingToggle} 
                        onClick={(e) => { if (!this.state.hasDragged) this.handleToggle(); }}
                        onMouseDown={this.handleMouseDown}
                        title="唤醒 AI 编程导师"
                        style={this.state.position ? { left: this.state.position.x, top: this.state.position.y, right: 'auto', bottom: 'auto' } : {}}
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
                            <div className={styles.chatHeaderLeft}>
                                <span style={{ fontSize: '18px' }}>🤖 Socratic Scratch AI</span>
                                <div className={styles.zoomControls}>
                                    <button className={styles.zoomBtn} onClick={(e) => { e.stopPropagation(); this.setState({zoom: Number((zoom - 0.1).toFixed(1))}); }}>A-</button>
                                    <button className={styles.zoomBtn} onClick={(e) => { e.stopPropagation(); this.setState({zoom: 1.0}); }}>回正</button>
                                    <button className={styles.zoomBtn} onClick={(e) => { e.stopPropagation(); this.setState({zoom: Number((zoom + 0.1).toFixed(1))}); }}>A+</button>
                                </div>
                            </div>
                            <div className="chatToggleContainer" onMouseDown={e => e.stopPropagation()}>
                                <button className={styles.chatToggle} onClick={this.handleToggle} style={{cursor: 'pointer'}}>×</button>
                            </div>
                        </div>
                        
                        <div className={styles.chatMessages} style={{ zoom: zoom }}>
                        {displayMessages.map((msg, idx) => (
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

                    {currentSuggestions.length > 0 && (
                        <div className={styles.suggestionsContainer}>
                            {currentSuggestions.map((sugg, i) => (
                                <div key={i} className={styles.suggestionPill} onClick={() => this.handleSend(sugg)}>
                                    {sugg}
                                </div>
                            ))}
                        </div>
                    )}

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
