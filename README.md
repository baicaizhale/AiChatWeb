# AiChatWeb

## 项目简介
AiChatWeb 是一个基于 Web 的简易聊天界面，前端使用 HTML、CSS 和 JavaScript，后端采用 PHP 实现。

## 功能特性
- 支持用户输入消息并显示在聊天窗口
- 前后端分离，异步通信
- 简洁美观的界面设计

## 文件结构
- `index.html`：主页面，包含聊天窗口和输入框
- `style.css`：页面样式文件
- `script.js`：前端交互逻辑
- `back.php`：后端消息处理脚本
- `LICENSE`：开源协议
- `README.md`：项目说明文档

## 快速开始
1. 克隆项目到本地：
   ```bash
   git clone https://github.com/baicaizhale/AiChatWeb
   ```
2. 修改`back.php`中的用户名与密钥（前后端搭配版）
   使用本地版跳过第2、3步
3. 启动本地 PHP 服务（如使用 XAMPP/WAMP 或命令行）：
   ```bash
   php -S localhost:8080
   ```
4. 在浏览器中访问 `http://localhost:8080/index.html`
   本地版直接打开`index.html`即可。

## 使用说明
- 在输入框输入消息，点击发送即可与后端交互。
- 后端可根据需求扩展为接入 AI 或数据库。

## 许可证
本项目采用 GPL v3 协议，详见 LICENSE 文件。
