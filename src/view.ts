
import * as vscode from 'vscode';
import { parseChapters } from './chapterParser';
import { Novel } from './sidebar';
import { GlobalStateEnum } from './globalStateEnum';
import { readTextFileWithAutoEncoding } from './utils';

export class NovelReaderViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'novelReaderBottomContainerView';

    private _view?: vscode.WebviewView;
    private _currentNovel: Novel | undefined;
    private _chapters: { title: string, content: string }[] = [];
    private _currentChapterIndex: number = 0;
    private _pendingChapter: { novel: Novel, chapterIndex: number } | undefined;

    constructor(private readonly _context: vscode.ExtensionContext) { }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._context.extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(message => {
            switch (message.command) {
                case 'nextChapter':
                    vscode.commands.executeCommand('novelReader.nextChapter');
                    return;
                case 'previousChapter':
                    vscode.commands.executeCommand('novelReader.previousChapter');
                    return;
                case 'closeReader':
                    this.clearView();
                    return;
                case 'updateFontSize':
                    this._context.globalState.update(GlobalStateEnum.FONT_SIZE, message.payload);
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
                this._context.globalState.update(GlobalStateEnum.NOVELS, novels);
            }

            this.loadChapter(this._currentNovel, newIndex);
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
                    }
                    .nav-buttons.bottom {
                        margin-top: 1em;
                    }
                    .font-controls, .page-controls, .close-controls {
                        display: flex;
                        gap: 0.5em;
                        align-items: center;
                    }
                    button {
                        padding: 0.25em 0.75em;
                        border: 1px solid var(--vscode-button-border);
                        background-color: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        cursor: pointer;
                        font-size: 0.9em;
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
                    }
                    .font-size-display {
                        min-width: 3em;
                        text-align: center;
                    }
                </style>
            </head>
            <body>
                <div id="reader-container" class="hidden">
                    <div class="nav-buttons top">
                        <div class="font-controls">
                            <button id="font-decrease-top">-</button>
                            <button id="font-increase-top">+</button>
                            <span id="font-size-top" class="font-size-display">16px</span>
                        </div>
                        <div class="page-controls">
                            <button id="prev-top">Previous</button>
                            <button id="next-top">Next</button>
                        </div>
                        <div class="close-controls">
                            <button id="close-top">x</button>
                        </div>
                    </div>

                    <h1 id="title"></h1>
                    <div id="content"></div>

                    <div class="nav-buttons bottom">
                        <div class="font-controls">
                            <button id="font-decrease-bottom">-</button>
                            <button id="font-increase-bottom">+</button>
                            <span id="font-size-bottom" class="font-size-display">16px</span>
                        </div>
                        <div class="page-controls">
                            <button id="prev-bottom">Previous</button>
                            <button id="next-bottom">Next</button>
                        </div>
                        <div class="close-controls">
                            <button id="close-bottom">x</button>
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

                    // --- Button Elements ---
                    const elements = {
                        prev: [document.getElementById('prev-top'), document.getElementById('prev-bottom')],
                        next: [document.getElementById('next-top'), document.getElementById('next-bottom')],
                        fontIncrease: [document.getElementById('font-increase-top'), document.getElementById('font-increase-bottom')],
                        fontDecrease: [document.getElementById('font-decrease-top'), document.getElementById('font-decrease-bottom')],
                        fontSizeDisplay: [document.getElementById('font-size-top'), document.getElementById('font-size-bottom')],
                        close: [document.getElementById('close-top'), document.getElementById('close-bottom')]
                    };

                    // --- Event Listeners ---
                    elements.prev.forEach(el => el.addEventListener('click', () => vscode.postMessage({ command: 'previousChapter' })));
                    elements.next.forEach(el => el.addEventListener('click', () => vscode.postMessage({ command: 'nextChapter' })));
                    elements.close.forEach(el => el.addEventListener('click', () => vscode.postMessage({ command: 'closeReader' })));
                    elements.fontIncrease.forEach(el => el.addEventListener('click', () => updateFontSize('increase')));
                    elements.fontDecrease.forEach(el => el.addEventListener('click', () => updateFontSize('decrease')));

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
                        vscode.postMessage({ command: 'updateFontSize', payload: currentFontSize });
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
                                vscode.postMessage({ command: 'previousChapter' });
                            } else if (event.key === 'ArrowRight') {
                                event.preventDefault();
                                vscode.postMessage({ command: 'nextChapter' });
                            }
                            // Handle Ctrl+Delete to reset view
                            else if (event.ctrlKey && event.key === 'Delete') {
                                event.preventDefault();
                                vscode.postMessage({ command: 'closeReader' });
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
