import os
import sys
import subprocess
import requests

TOKEN = "7e758f6b0901ac0d1c1dc5b84aadbd8e"
REPO_NAME = "scratch_ai_assistant"
ZIP_PATH = "scratch-gui/dist-portable.zip"
API_BASE = "https://gitee.com/api/v5"

def run_cmd(cmd):
    print(f"Running: {cmd}")
    res = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    if res.returncode != 0:
        print(f"Command failed: {res.stderr}")
    return res

def main():
    print("1. Fetching user info...")
    resp = requests.get(f"{API_BASE}/user?access_token={TOKEN}")
    if resp.status_code != 200:
        print("Failed to authenticate with token!")
        print(resp.text)
        return
        
    user_data = resp.json()
    username = user_data.get('login')
    print(f"Authenticated as: {username}")
    
    # 2. Check if repo exists
    resp_repo = requests.get(f"{API_BASE}/repos/{username}/{REPO_NAME}?access_token={TOKEN}")
    if resp_repo.status_code == 404:
        print("Repo not found. Creating it...")
        create_resp = requests.post(
            f"{API_BASE}/user/repos",
            json={
                "access_token": TOKEN,
                "name": REPO_NAME,
                "private": False,
                "description": "Scratch AI Assistant packaged for Windows"
            }
        )
        if create_resp.status_code != 201:
            print("Creation failed:", create_resp.text)
            return
        print("Repo created!")
    else:
        print("Repo already exists.")
        
    # Commit any lingering changes
    run_cmd("git add .")
    run_cmd('git commit -m "chore: align README changes and prepare for Gitee transfer"')

    # 3. Push to Gitee
    remote_url = f"https://{username}:{TOKEN}@gitee.com/{username}/{REPO_NAME}.git"
    print("Pushing to Gitee...")
    push_res = run_cmd(f"git push {remote_url} main --force")
    if push_res.returncode != 0:
        print("Fallback to master branch push...")
        run_cmd(f"git push {remote_url} HEAD:master --force")
        branch_to_use = "master"
    else:
        branch_to_use = "main"

    version = "v1.2.0"
    print(f"4. Creating release {version}...")
    rel_resp = requests.post(
        f"{API_BASE}/repos/{username}/{REPO_NAME}/releases",
        json={
            "access_token": TOKEN,
            "tag_name": version,
            "name": f"{version} 终极护航版",
            "body": "1. 原生诊断级防呆\n2. 5001 端口彻底改为本地回环连接避免防火墙屏蔽\n3. 新版 UI 支持明确的错误指引与开发者介绍",
            "target_commitish": branch_to_use
        }
    )
    if rel_resp.status_code not in [201, 200]:
        print("Release creation failed:", rel_resp.text)
        return
        
    release_id = rel_resp.json().get('id')
    print(f"Release created with ID: {release_id}")
    
    print("5. Uploading portable ZIP...")
    if not os.path.exists(ZIP_PATH):
        print(f"ZIP path {ZIP_PATH} not found!")
        return
        
    upload_url = f"{API_BASE}/repos/{username}/{REPO_NAME}/releases/{release_id}/attach_files"
    with open(ZIP_PATH, 'rb') as f:
        files = {'file': (os.path.basename(ZIP_PATH), f, 'application/zip')}
        data = {'access_token': TOKEN}
        up_resp = requests.post(upload_url, data=data, files=files)
        
    if up_resp.status_code in [200, 201]:
        print("Upload successful!")
        print(up_resp.json())
    else:
        print("Upload failed:", up_resp.status_code, up_resp.text)

if __name__ == "__main__":
    main()
