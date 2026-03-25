import os
import json
import zipfile
import base64
import time
from flask import Flask, request, jsonify, send_file, Response, render_template_string
from flask_cors import CORS
import dashscope
from dotenv import load_dotenv

app = Flask(__name__, static_folder='static')
CORS(app)
os.makedirs("static/projects", exist_ok=True)

def get_api_key():
    load_dotenv(override=True)
    return os.environ.get("DASHSCOPE_API_KEYS", "").split(',')[0]

# --- Scratch SB3 Generator Helper ---
def generate_sb3_template(project_id="10128407"):
    """
    利用 scratchattach 接口下载一个线上开源的模板项目，修改其中的代码积木
    为了保证本地绝对可用并提升速度，这里我实际上可以用硬编码的一个极简合法 project.json
    然后生成并压缩为一个合法的 sb3 格式。
    """
def inject_sb3_template(base_path, new_filename, generated_blocks, summary_text):
    """
    真正的 SB3 重组黑魔法：读取现成的绝对合法的底包项目，
    然后在内存中解包、修改 project.json（注入云通信变量和生成的积木树），再打包。
    """
    out_path = os.path.join("static/projects", new_filename)
    
    with zipfile.ZipFile(base_path, 'r') as src, zipfile.ZipFile(out_path, 'w') as dst:
        for item in src.infolist():
            if item.filename == "project.json":
                p_json = json.loads(src.read(item.filename).decode('utf-8'))
                
                # 给所有 Sprite (甚至 Stage) 埋入云交互变量，给主角小猫(非Stage)注入积木和备注块！
                for target in p_json.get("targets", []):
                    if target.get("isStage"):
                        if "variables" not in target:
                            target["variables"] = {}
                        target["variables"]["cloud_prompt"] = ["\u2601 prompt", "", True]
                        target["variables"]["cloud_response"] = ["\u2601 response", "", True]
                    elif target.get("name") == "Sprite1" or (not target.get("isStage")):
                        # 将大模型生成的积木 JSON 注入
                        if generated_blocks:
                            target["blocks"] = generated_blocks
                        # 增加巨型黄色便利贴备注，防止积木生成有瑕疵让孩子找不着调
                        if "comments" not in target:
                            target["comments"] = {}
                        target["comments"]["ai_comment_1"] = {
                            "blockId": None,
                            "x": 200, "y": 50, "width": 400, "height": 300,
                            "minimized": False,
                            "text": f"🚀 AI 编程教练留言：\n\n{summary_text}\n\n（如果没有看到完整的积木，可以按照这段提示自己动手拖拽哦！）"
                        }
                
                # 自动检测积木树中是否用到了扩展库（比如 videoSensing, text2speech 等），并强行加入到项目 meta 中
                PREFIX_MAP = {
                    "pen": "pen", "videoSensing": "videoSensing", "video": "videoSensing", 
                    "text2speech": "text2speech", "tts": "text2speech", "translate": "translate", 
                    "music": "music", "microbit": "microbit", "ev3": "ev3", "wedo2": "wedo2", "makeymakey": "makeymakey"
                }
                extensions_set = set(p_json.get("extensions", []))
                if generated_blocks:
                    for b_id, b_data in generated_blocks.items():
                        opcode = b_data.get("opcode", "")
                        if "_" in opcode:
                            prefix = opcode.split("_")[0]
                            if prefix in PREFIX_MAP:
                                extensions_set.add(PREFIX_MAP[prefix])
                p_json["extensions"] = list(extensions_set)
                        
                dst.writestr("project.json", json.dumps(p_json))
            else:
                dst.writestr(item, src.read(item.filename))
                
    return out_path

@app.route('/')
def index():
    from flask import make_response
    resp = make_response(send_file('index.html'))
    resp.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    resp.headers['Pragma'] = 'no-cache'
    return resp

@app.route('/api/chat', methods=['POST'])
def chat():
    data = request.json
    messages = data.get('messages', [])
    if not messages:
        return jsonify({"error": "消息不能为空"}), 400
        
    api_key = get_api_key()
    if not api_key:
        return jsonify({"error": "未配置大模型 API Key！"}), 400
    dashscope.api_key = api_key
    
    # dynamically load persona to allow real-time edits without restarting (if possible)
    persona_path = os.path.join(os.path.dirname(__file__), 'ai_persona.txt')
    try:
        with open(persona_path, 'r', encoding='utf-8') as f:
            system_prompt = f.read()
    except FileNotFoundError:
        system_prompt = '''你是一位顶流的少儿编程教育专家。请以【苏格拉底式提问】引导学生学习 Scratch。
核心规则：
1. 一步一步启发式提问，不要直接给完所有代码！
2. 【致命纪律】：每次提到具体的积木指令，【绝对严禁】使用纯文字或单反引号，必须放在 ```scratch 和 ``` 组成的【多行代码块】中输出！'''

    msgs_payload = [{'role': 'system', 'content': system_prompt}]
    for m in messages:
        msgs_payload.append({'role': m['role'], 'content': m['content']})

    def generate_stream():
        response = dashscope.Generation.call(
            model='qwen-plus',
            messages=msgs_payload,
            result_format='message',
            stream=True,
            incremental_output=True
        )
        for res in response:
            if res.status_code == 200:
                content = res.output.choices[0]['message']['content']
                if content:
                    yield f"data: {json.dumps({'content': content})}\n\n"
            else:
                yield f"data: {json.dumps({'error': res.message})}\n\n"
                
    return Response(generate_stream(), mimetype='text/event-stream')

@app.route('/api/generate_sb3', methods=['POST'])
def generate_sb3():
    """根据目前的对话流生成 SB3 以及总结"""
    data = request.json
    messages = data.get('messages', [])
    
    api_key = get_api_key()
    if not api_key:
        return jsonify({"error": "未配置 API Key！"}), 400
    dashscope.api_key = api_key
    
    summarize_prompt = """请总结上文引导过程。输出要求：
1. 梳理出使用了哪些【关键积木组合】。
2. 说明涉及的【计算思维】。
3. 请将建议的积木严格写作为全英文的标准 scratchblocks 代码块！例如：
```scratch
when flag clicked
move (10) steps
```
"""
    msgs_payload = [{'role': m['role'], 'content': m['content']} for m in messages]
    msgs_payload.append({'role': 'user', 'content': summarize_prompt})
    response_sum = dashscope.Generation.call(model='qwen-plus', messages=msgs_payload, result_format='message')
    summary_md = response_sum.output.choices[0]['message']['content'] if response_sum.status_code == 200 else "总结暂无"

    # 为彻底避免 Scratch 3.0 底层因 AST 格式残缺导致整体加载崩溃
    # 停止使用动态不可靠的 LLM JSON 生成，转而注入一段极度稳定合法的【苏格拉底打底积木】，配合便利贴引导。
    generated_blocks = {
        "fake_start_block": {
            "opcode": "event_whenflagclicked",
            "next": "fake_say_block",
            "parent": None,
            "inputs": {},
            "fields": {},
            "topLevel": True,
            "x": 50,
            "y": 50
        },
        "fake_say_block": {
            "opcode": "looks_say",
            "next": None,
            "parent": "fake_start_block",
            "inputs": {
                "MESSAGE": [1, [10, "Hello! 小创客，我已经把核心积木写在右边大黄纸条里啦，快去拼接吧！能跟我连接云变量哦~"]]
            },
            "fields": {},
            "topLevel": False
        }
    }
    
    base_sb3_path = "static/projects/base.sb3"
    filename = f"AI_Project_{int(time.time())}.sb3"
    
    # 动态注入积木 AST 和 便利贴备忘录！
    inject_sb3_template(base_sb3_path, filename, generated_blocks, summary_md)
    
    py_code = """import scratchattach as sa
import time

# ==========================================
# 智创未来 Scratch-Python 强强联手机器人！
# ==========================================
# 请确保你的电脑有 Python 环境，并在终端执行了: pip install scratchattach
# 由于云变量强制限制，请把你刚才下载的 AI_Project.sb3 上传到 Scratch 官网！

# 在下面填上你的 Scratch 官网账号和项目数字 ID
session = sa.login("您的用户名", "您的密码")
cloud = session.connect_cloud("您的项目ID数字")

print("🤖 AI 魔法桥接器启动成功！小猫现在能听懂代码指令啦~")

while True:
    val = cloud.get_var("prompt")
    if val:
        print(f"收到作品里小猫的请求: {val}")
        # 在这里发挥你的想象力，可以接入各种大模型库给小猫回话哦！
        cloud.set_var("response", "收到啦_" + str(val))
    time.sleep(1)
"""
    
    return jsonify({
        "success": True,
        "summary": summary_md,
        "sb3_url": f"/static/projects/{filename}",
        "py_code": py_code
    })

@app.route('/api/compile_sb3_block', methods=['POST'])
def compile_sb3_block():
    data = request.json
    block_text = data.get('block_text', '')
    api_key = get_api_key()
    if not api_key:
        return jsonify({"error": "未配置 API Key！"}), 400
    
    dashscope.api_key = api_key
    
    system_prompt = """你是一个专门将 scratchblocks 语法翻译为原版 Scratch 3.0 AST JSON 数组的编译器。
你的输出只能是一个合法的 JSON 数组（Array of Objects），并且这个 JSON 需要能直接被 scratch-vm 的 shareBlocksToTarget 函数接受。不要输出任何多余的 Markdown 标记（例如 ```json）或其他文字。
每个 block 对象必须包含：
- id (独立的字符串，建议形如 "block_XXX")
- opcode (合法的 Scratch opcode，如 event_whenflagclicked, motion_movesteps)
- next (指向下一个 block 的 id，没有填 null)
- parent (上一个 block 的 id，没有填 null)
- inputs (输入参数字典，例如："STEPS": [1, [4, "10"]])
- fields (字段参数字典)
- shadow (布尔值 false)
- topLevel (布尔值)
- 如果是首个积木，通常加上 "x": 100, "y": 100 方便在画布看到。
要求：确保数组内第一个积木的 topLevel 为 true，其余为 false。
请根据用户的英文代码片段，精准生成严格格式对应的 JSON 数组。返回结果必须是从 [ 开始的 JSON！"""

    try:
        print(f"DEBUG Compiler Input: {block_text}", flush=True)
        response = dashscope.Generation.call(
            model='qwen-plus',
            messages=[
                {'role': 'system', 'content': system_prompt},
                {'role': 'user', 'content': block_text}
            ],
            result_format='message'
        )
        if response.status_code == 200:
            content = response.output.choices[0]['message']['content']
            print(f"DEBUG Compiler Output: {content}", flush=True)
            content = content.replace("```json", "").replace("```", "").strip()
            if not content.startswith("["):
                start = content.find("[")
                end = content.rfind("]")
                if start != -1 and end != -1:
                    content = content[start:end+1]
                else:
                    return jsonify({"error": "大模型返回的不是合法 JSON 数组", "raw": content}), 500
            blocks_array = json.loads(content)
            return jsonify({"status": "success", "blocks": blocks_array}), 200
        else:
            return jsonify({"error": f"API调用失败: {response.code}"}), 500
    except Exception as e:
        return jsonify({"error": f"编译异常: {str(e)}"}), 500

if __name__ == '__main__':
    print("🚀 Scratch AI 编程助手 - 后端启动运行于端口 5001")
    app.run(host='0.0.0.0', port=5001)
