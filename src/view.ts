
import * as vscode from 'vscode';
import { parseChapters } from './chapterParser';
import { Novel } from './sidebar';
import { GlobalStateEnum } from './enums/globalStateEnum';
import { VscodeCommandEnum } from './enums/vscodeCommandEnum';
import { readTextFileWithAutoEncoding } from './utils';

const NEXT_CHAPTER = 'nextChapter';
const PREVIOUS_CHAPTER = 'previousChapter';
const CTRL_DELETE = 'ctrl+delete';
const CLOSE_READER = 'closeReader';
const UPDATE_FONT_SIZE = 'updateFontSize';
const TOGGLE_CONTROLS = 'toggleControls';

export class NovelReaderViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'novelReaderBottomContainerView';

    private _view?: vscode.WebviewView;
    private _currentNovel: Novel | undefined;
    private _chapters: { title: string, content: string }[] = [];
    private _currentChapterIndex: number = 0;
    private _pendingChapter: { novel: Novel, chapterIndex: number } | undefined;
    private _controlsVisible: boolean = true;

    constructor(private readonly _context: vscode.ExtensionContext) { }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        // 初始化控制面板可见性状态
        this._controlsVisible = this._context.globalState.get(GlobalStateEnum.CONTROLS_VISIBLE, true);

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._context.extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(message => {
            switch (message.command) {
                case NEXT_CHAPTER:
                    vscode.commands.executeCommand(VscodeCommandEnum.NEXT_CHAPTER);
                    return;
                case PREVIOUS_CHAPTER:
                    vscode.commands.executeCommand(VscodeCommandEnum.PREVIOUS_CHAPTER);
                    return;
                case CTRL_DELETE:
                    if (!this._currentNovel) {
                        vscode.commands.executeCommand(VscodeCommandEnum.SHOW_CURRENT_NOVEL);
                    } else {
                        this.clearView();
                    }
                    return;
                case CLOSE_READER:
                    this.clearView();
                    return;
                case UPDATE_FONT_SIZE:
                    this._context.globalState.update(GlobalStateEnum.FONT_SIZE, message.payload);
                    return;
                case TOGGLE_CONTROLS:
                    this._toggleControls();
                    return;
            }
        });

        webviewView.onDidDispose(() => {
            this._view = undefined;
        });

        // If a chapter was selected while the view was closed, load it now.
        if (this._pendingChapter) {
            this.loadChapter(this._pendingChapter.novel, this._pendingChapter.chapterIndex);
            this._pendingChapter = undefined;
        }
    }

    public clearView() {
        this._currentNovel = undefined;
        this._currentChapterIndex = 0;
        this._chapters = [];
        if (this._view) {
            this._view.webview.postMessage({ command: 'resetView' });
        }
    }

    public loadChapter(novel: Novel, chapterIndex: number) {
        if (!this._view) {
            // View isn't ready, store the chapter and focus the view.
            this._pendingChapter = { novel, chapterIndex };
            vscode.commands.executeCommand('novelReaderBottomContainerView.focus');
            return; // Exit here
        }

        this._currentNovel = novel;
        this._currentChapterIndex = chapterIndex;

        try {
            const novelText = readTextFileWithAutoEncoding(novel.path);
            this._chapters = parseChapters(novelText);
            const chapter = this._chapters[chapterIndex];

            if (this._view && chapter) {
                this._view.show(true); // Show the view panel
                this._view.webview.postMessage({
                    command: 'updateContent',
                    payload: {
                        title: chapter.title,
                        content: chapter.content,
                        isFirst: chapterIndex === 0,
                        isLast: chapterIndex === this._chapters.length - 1,
                        fontSize: this._context.globalState.get(GlobalStateEnum.FONT_SIZE, 16)
                    }
                });

                // 更新最后观看的小说ID
                if (novel.id) {
                  this._context.globalState.update(GlobalStateEnum.LAST_VIEWED_NOVEL_ID, novel.id);
                }
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Error loading chapter: ${error}`);
        }
    }

    public navigateChapter(direction: 'next' | 'previous') {
        if (!this._currentNovel) {
            vscode.window.showInformationMessage('Please open a novel first.');
            return;
        }

        let newIndex = this._currentChapterIndex;
        if (direction === 'next') {
            newIndex++;
        } else {
            newIndex--;
        }

        if (newIndex >= 0 && newIndex < this._chapters.length) {
            // Update the current chapter in the global state
            const novels = this._context.globalState.get<Novel[]>(GlobalStateEnum.NOVELS, []);
            const novelToUpdate = novels.find(n => n.path === this._currentNovel!.path);
            if (novelToUpdate) {
                novelToUpdate.currentChapter = newIndex;
                this._context.globalState.update(GlobalStateEnum.NOVELS, novels).then(() => {
                    vscode.commands.executeCommand(VscodeCommandEnum.REFRESH_SIDEBAR); // Refresh sidebar to show new chapter
                });
            }

            this.loadChapter(this._currentNovel, newIndex);
        }
    }

    private _toggleControls() {
        this._controlsVisible = !this._controlsVisible;
        this._context.globalState.update(GlobalStateEnum.CONTROLS_VISIBLE, this._controlsVisible);
        if (this._view) {
            this._view.webview.postMessage({ command: 'updateControlsVisibility', payload: this._controlsVisible });
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        const nonce = getNonce();
        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Novel Reader</title>
                <style>
                    body {
                        padding: 1em;
                        color: var(--vscode-editor-foreground);
                        background-color: var(--vscode-editor-background);
                        overflow-y: auto;
                    }
                    .nav-buttons {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        margin-bottom: 1em;
                        transition: all 0.3s ease;
                    }
                    .nav-buttons.bottom {
                        margin-top: 1em;
                    }
                    .nav-buttons.collapsed {
                        height: 0;
                        opacity: 0;
                        margin: 0;
                        overflow: hidden;
                    }
                    .nav-buttons.top {
                        position: relative;
                    }
                    .nav-buttons.bottom {
                        position: relative;
                    }
                    .controls-wrapper, .font-controls, .page-controls, .close-controls {
                        display: flex;
                        gap: 0.5em;
                        align-items: center;
                    }
                    .toggle-controls-btn {
                        position: absolute;
                        top: -15px;
                        left: 50%;
                        transform: translateX(-50%);
                        width: 30px;
                        height: 15px;
                        padding: 0;
                        border: 1px solid var(--vscode-button-border);
                        background-color: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        cursor: pointer;
                        border-radius: 12px;
                        font-size: 10px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        z-index: 10;
                        transition: all 0.2s ease;
                    }
                    .toggle-controls-btn:hover {
                        background-color: var(--vscode-button-hoverBackground);
                    }
                    button {
                        padding: 0.25em 0.75em;
                        border: 1px solid var(--vscode-button-border);
                        background-color: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        cursor: pointer;
                        font-size: 0.9em;
                        border-radius: 3px;
                    }
                    button:hover {
                        background-color: var(--vscode-button-hoverBackground);
                    }
                    button:disabled {
                        cursor: not-allowed;
                        opacity: 0.5;
                    }
                    #reader-container.hidden, .hidden {
                        display: none !important;
                    }
                    #welcome-message {
                        text-align: center;
                        font-size: 1.2em;
                        height: 100%;
                        display: flex;
                        justify-content: center;
                        align-items: center;
                    }
                    #title, #content {
                        white-space: pre-wrap;
                        line-height: 1.6;
                        margin: 0;
                        padding: 0;
                    }
                    .font-size-display {
                        min-width: 3em;
                        text-align: center;
                    }
                </style>
                <style>
                    /* 极简手风琴样式 */
                    .accordion-nav {
                        border: 1px solid var(--vscode-panel-border, rgba(128, 128, 128, 0.15));
                        border-radius: 3px;
                        margin: 0.2em 0;
                        background-color: var(--vscode-editor-background);
                        box-shadow: 0 0 0 1px var(--vscode-widget-shadow, transparent);
                    }

                    .accordion-header {
                        display: flex;
                        align-items: center;
                        padding: 0.3em 0.7em;
                        background-color: var(--vscode-editor-background);
                        border-bottom: 1px solid var(--vscode-panel-border, rgba(128, 128, 128, 0.1));
                        cursor: pointer;
                        user-select: none;
                        transition: all 0.15s ease;
                    }

                    .accordion-header:hover {
                        background-color: var(--vscode-list-hoverBackground, rgba(128, 128, 128, 0.05));
                    }

                    .accordion-header:active {
                        background-color: var(--vscode-list-activeSelectionBackground, rgba(255,255,255,0.1));
                    }

                    .accordion-title {
                        font-weight: 500;
                        color: var(--vscode-descriptionForeground);
                        font-size: 0.8em;
                        letter-spacing: 0.3px;
                        text-transform: none;
                        opacity: 0.95;
                    }

                    .accordion-toggle {
                        background: none;
                        border: none;
                        padding: 0;
                        font-size: 9px;
                        color: var(--vscode-descriptionForeground);
                        cursor: pointer;
                        transition: transform 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94);
                        width: 14px;
                        height: 14px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        outline: none;
                        opacity: 0.8;
                    }

                    .accordion-toggle:hover {
                        opacity: 1;
                        transform: scale(1.15);
                        color: var(--vscode-foreground);
                    }

                    .accordion-toggle.expanded {
                        transform: rotate(0deg);
                    }

                    .accordion-toggle.collapsed {
                        transform: rotate(-90deg);
                    }

                    .accordion-content {
                        overflow: hidden;
                        transition: max-height 0.25s cubic-bezier(0.4, 0, 0.2, 1);
                        max-height: 60px; /* 更紧凑的高度 */
                    }

                    .accordion-content.collapsed {
                        max-height: 0;
                    }

                    .accordion-content .controls-container {
                        padding: 0.5em 0.7em;
                        display: flex;
                        gap: 2em;
                        align-items: center;
                        background-color: var(--vscode-editor-background);
                    }

                    .controls-container {
                        background: none;
                    }

                    .font-controls, .page-controls, .close-controls {
                        display: flex;
                        gap: 0.4em;
                        align-items: center;
                    }

                    /* 简约按钮样式 */
                    .controls-container button {
                        padding: 0.3em 0.6em;
                        border: 1px solid var(--vscode-button-border, rgba(128, 128, 128, 0.3));
                        background-color: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        cursor: pointer;
                        font-size: 0.75em;
                        border-radius: 2px;
                        transition: all 0.15s ease;
                        line-height: 1.2;
                        min-width: 24px;
                        text-align: center;
                        font-family: var(--vscode-editor-font-family, 'Monaco', 'Consolas');
                        font-weight: 400;
                        letter-spacing: 0.3px;
                    }

                    .controls-container button:hover {
                        background-color: var(--vscode-button-hoverBackground);
                        border-color: var(--vscode-focusBorder);
                        transform: translateY(-1px);
                        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
                    }

                    .controls-container button:active {
                        transform: translateY(0);
                        box-shadow: none;
                    }

                    .controls-container button:disabled {
                        cursor: not-allowed;
                        opacity: 0.4;
                        transform: none;
                        box-shadow: none;
                    }

                    /* 键盘高亮样式 */
                    .controls-container button:focus {
                        outline: 1px solid var(--vscode-focusBorder);
                        outline-offset: 1px;
                    }

                    // .controls-container span {
                    //     font-size: 0.75em;
                    //     color: var(--vscode-descriptionForeground);
                    //     opacity: 0.8;
                    //     user-select: none;
                    //    cursor: default;
                    // }

                    /* 简约字体显示 */
                    .font-size-display {
                        min-width: 2.5em;
                        text-align: center;
                        font-size: 0.7em;
                        color: var(--vscode-descriptionForeground);
                        background-color: var(--vscode-input-background);
                        border: 1px solid var(--vscode-input-border);
                        padding: 0.2em 0.4em;
                        border-radius: 2px;
                    }

                    /* 深色模式优化 */
                    .accordion-nav {
                        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
                    }

                    /* 整体内容区域调整 */
                    #title {
                        font-size: 1.1em;
                        margin-bottom: 0.6em;
                        color: var(--vscode-foreground);
                        font-weight: 500;
                    }

                    #content {
                        line-height: 1.8;
                        color: var(--vscode-foreground);
                        font-family: var(--vscode-editor-font-family, 'Consolas', 'Monaco');
                        font-size: calc(var(--vscode-editor-font-size, 14px) * 0.95);
                        color: var(--vscode-editor-foreground);
                        text-rendering: optimizeLegibility;
                        -webkit-font-smoothing: antialiased;
                        -moz-osx-font-smoothing: grayscale;
                    }

                    /* 阅读区域间距优化 */
                    #reader-container {
                        padding: 0.4em 0.8em;
                        margin: 0 0.1em;
                        gap: 0.4em;
                        display: flex;
                        flex-direction: column;
                    }

                    /* 深色模式整体优化 */
                    @media (prefers-color-scheme: dark) {
                        .accordion-nav {
                            background-color: var(--vscode-editor-background);
                            border-color: var(--vscode-panel-border, rgba(255, 255, 255, 0.08));
                        }
                        .accordion-header {
                            border-color: var(--vscode-panel-border, rgba(255, 255, 255, 0.05));
                        }
                    }

                    @media (prefers-color-scheme: light) {
                        .accordion-nav {
                            background-color: var(--vscode-editor-background);
                            border-color: var(--vscode-panel-border, rgba(0, 0, 0, 0.08));
                        }
                    }
                </style>
            </head>
            <body>
                <div id="reader-container" class="hidden">
                    <!-- 顶部手风琴 -->
                    <div class="accordion-nav">
                        <div class="accordion-header">
                            <button class="accordion-toggle ${this._controlsVisible ? 'expanded' : 'collapsed'}">
                                ▼
                            </button>
                            <span class="accordion-title">阅读控件</span>
                        </div>
                        <div class="accordion-content ${this._controlsVisible ? '' : 'collapsed'}">
                            <div class="controls-container">
                                <div class="font-controls">
                                    <button id="font-decrease-top">-</button>
                                    <button id="font-increase-top">+</button>
                                    <span id="font-size-top" class="font-size-display">16px</span>
                                </div>
                                <div class="page-controls">
                                    <span class="font-size-display">(快捷键: ←)</span>
                                    <button id="prev-top">Previous</button>
                                    <button id="next-top">Next</button>
                                    <span class="font-size-display">(快捷键: →)</span>
                                </div>
                                <div class="close-controls">
                                    <button id="close-top">x</button>
                                    <span class="font-size-display">(快捷键: CTRL+DEL)</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <h1 id="title"></h1>
                    <div id="content"></div>

                    <!-- 底部手风琴 -->
                    <div class="accordion-nav">
                        <div class="accordion-header">
                            <button class="accordion-toggle ${this._controlsVisible ? 'expanded' : 'collapsed'}">
                                ▼
                            </button>
                            <span class="accordion-title">阅读控件</span>
                        </div>
                        <div class="accordion-content ${this._controlsVisible ? '' : 'collapsed'}">
                            <div class="controls-container">
                                <div class="font-controls">
                                    <button id="font-decrease-bottom">-</button>
                                    <button id="font-increase-bottom">+</button>
                                    <span id="font-size-bottom" class="font-size-display">16px</span>
                                </div>
                                <div class="page-controls">
                                    <span class="font-size-display">(快捷键: ←)</span>
                                    <button id="prev-bottom">Previous</button>
                                    <button id="next-bottom">Next</button>
                                    <span class="font-size-display">(快捷键: →)</span>
                                </div>
                                <div class="close-controls">
                                    <button id="close-bottom">x</button>
                                    <span class="font-size-display">(快捷键: CTRL+DEL)</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div id="welcome-message">Hello, I am reader.</div>

                <script nonce="${nonce}">
                    const vscode = acquireVsCodeApi();

                    const readerContainer = document.getElementById('reader-container');
                    const welcomeMessage = document.getElementById('welcome-message');
                    const titleEl = document.getElementById('title');
                    const contentEl = document.getElementById('content');
                    
                    const FONT_STEP = 1;
                    const MIN_FONT_SIZE = 10;
                    const MAX_FONT_SIZE = 35;
                    let currentFontSize = 16;
                    let controlsVisible = ${this._controlsVisible};

                    // --- Button Elements ---
                    const elements = {
                        prev: [document.getElementById('prev-top'), document.getElementById('prev-bottom')],
                        next: [document.getElementById('next-top'), document.getElementById('next-bottom')],
                        fontIncrease: [document.getElementById('font-increase-top'), document.getElementById('font-increase-bottom')],
                        fontDecrease: [document.getElementById('font-decrease-top'), document.getElementById('font-decrease-bottom')],
                        fontSizeDisplay: [document.getElementById('font-size-top'), document.getElementById('font-size-bottom')],
                        close: [document.getElementById('close-top'), document.getElementById('close-bottom')]
                    };

                    // 获取手风琴元素
                    const accordionHeaders = document.querySelectorAll('.accordion-header');
                    const accordionToggles = document.querySelectorAll('.accordion-toggle');
                    const accordionContents = document.querySelectorAll('.accordion-content');

                    // --- Event Listeners ---
                    elements.prev.forEach(el => el.addEventListener('click', () => vscode.postMessage({ command: '${PREVIOUS_CHAPTER}' })));
                    elements.next.forEach(el => el.addEventListener('click', () => vscode.postMessage({ command: '${NEXT_CHAPTER}' })));
                    elements.close.forEach(el => el.addEventListener('click', () => vscode.postMessage({ command: '${CLOSE_READER}' })));
                    elements.fontIncrease.forEach(el => el.addEventListener('click', () => updateFontSize('increase')));
                    elements.fontDecrease.forEach(el => el.addEventListener('click', () => updateFontSize('decrease')));

                    // --- Accordion Functions ---
                    function toggleAccordion() {
                        controlsVisible = !controlsVisible;
                        updateAccordionUI();
                        // 发送到扩展保存状态
                        vscode.postMessage({ command: '${TOGGLE_CONTROLS}', payload: controlsVisible });
                    }

                    function updateAccordionUI() {
                        // 更新所有手风琴的状态（保持同步联动）
                        accordionHeaders.forEach(header => {
                            const content = header.parentElement.querySelector('.accordion-content');
                            const toggle = header.querySelector('.accordion-toggle');

                            if (controlsVisible) {
                                if (content) content.classList.remove('collapsed');
                                if (toggle) {
                                    toggle.classList.remove('collapsed');
                                    toggle.classList.add('expanded');
                                    toggle.textContent = '▼';
                                }
                            } else {
                                if (content) content.classList.add('collapsed');
                                if (toggle) {
                                    toggle.classList.remove('expanded');
                                    toggle.classList.add('collapsed');
                                    toggle.textContent = '▶';
                                }
                            }
                        });
                    }

                    // Initialize based on current state
                    if (!controlsVisible) {
                        updateAccordionUI();
                    }

                    // 为所有手风琴头部添加事件监听器（合成一个大手风琴，既可以点击任意位置）
                    if (accordionHeaders.length > 0) {
                        accordionHeaders.forEach(header => {
                            header.addEventListener('click', toggleAccordion);
                        });
                    }

                    // --- Functions ---
                    function updateFontSize(direction) {
                        if (direction === 'increase' && currentFontSize < MAX_FONT_SIZE) {
                            currentFontSize += FONT_STEP;
                        } else if (direction === 'decrease' && currentFontSize > MIN_FONT_SIZE) {
                            currentFontSize -= FONT_STEP;
                        }
                        titleEl.style.fontSize = currentFontSize + 'px';
                        contentEl.style.fontSize = currentFontSize + 'px';
                        elements.fontSizeDisplay.forEach(el => el.textContent = currentFontSize + 'px');
                        vscode.postMessage({ command: '${UPDATE_FONT_SIZE}', payload: currentFontSize });
                    }

                    function showReaderView() {
                        readerContainer.classList.remove('hidden');
                        welcomeMessage.classList.add('hidden');
                    }

                    function showWelcomeView() {
                        readerContainer.classList.add('hidden');
                        welcomeMessage.classList.remove('hidden');
                    }

                    // --- Keyboard Event Listeners ---
                    window.addEventListener('keydown', (event) => {
                        // Check if the webview is focused
                        if (document.hasFocus()) {
                            // Handle arrow keys for navigation
                            if (event.key === 'ArrowLeft') {
                                event.preventDefault();
                                vscode.postMessage({ command: '${PREVIOUS_CHAPTER}' });
                            } else if (event.key === 'ArrowRight') {
                                event.preventDefault();
                                vscode.postMessage({ command: '${NEXT_CHAPTER}' });
                            }
                            // Handle Ctrl+Delete to reset view
                            else if (event.ctrlKey && event.key === 'Delete') {
                                event.preventDefault();
                                vscode.postMessage({ command: '${CTRL_DELETE}' });
                            }
                        }
                    });

                    // --- Message Handling ---
                    window.addEventListener('message', event => {
                        const message = event.data;
                        switch (message.command) {
                            case 'updateContent':
                                const { title, content, isFirst, isLast, fontSize } = message.payload;
                                titleEl.textContent = title;
                                contentEl.textContent = content;

                                elements.prev.forEach(el => el.disabled = isFirst);
                                elements.next.forEach(el => el.disabled = isLast);

                                currentFontSize = fontSize;
                                updateFontSize();

                                showReaderView();
                                window.scrollTo(0, 0);
                                break;
                            case 'resetView':
                                showWelcomeView();
                                break;
                            case 'updateControlsVisibility':
                                const newControlsVisible = message.payload;
                                controlsVisible = newControlsVisible;
                                updateAccordionUI();
                                break;
                        }
                    });
                    </script>
            </body>
            </html>`;
    }
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
