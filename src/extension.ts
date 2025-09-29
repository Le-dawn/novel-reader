import * as vscode from 'vscode';
import * as path from 'path';
import * as crypto from 'crypto';
import * as fs from 'fs';
import { GlobalStateEnum } from './enums/globalStateEnum';
import { VscodeCommandEnum } from './enums/vscodeCommandEnum';
import { NovelSidebarProvider, Novel, NovelItem, ChapterItem } from './sidebar';
import { NovelReaderViewProvider } from './view';

export function getFileMD5(filePath: string): string {
    try {
        const fileBuffer = fs.readFileSync(filePath);
        return crypto.createHash('md5').update(fileBuffer).digest('hex');
    } catch (error) {
        console.error(`Error generating MD5 for file ${filePath}:`, error);
        return '';
    }
}

export function activate(context: vscode.ExtensionContext) {

    // 在启动时检查并更新所有小说的MD5 ID
    const novels = context.globalState.get<Novel[]>(GlobalStateEnum.NOVELS, []);
    let hasUpdates = false;

    for (const novel of novels) {
        if (!novel.id) {
            const md5Id = getFileMD5(novel.path);
            if (md5Id) {
                novel.id = md5Id;
                hasUpdates = true;
            }
        }
    }

    if (hasUpdates) {
        context.globalState.update(GlobalStateEnum.NOVELS, novels);
        console.log(`Updated ${novels.length} novels with MD5 IDs`);
    }

    // Create and register the sidebar provider
    const sidebarProvider = new NovelSidebarProvider(context);
    context.subscriptions.push(
        vscode.window.registerTreeDataProvider('novelReaderSidebar', sidebarProvider)
    );

    // Create and register the webview view provider
    const viewProvider = new NovelReaderViewProvider(context);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(NovelReaderViewProvider.viewType, viewProvider)
    );

    // Register the command to import a new novel
    context.subscriptions.push(vscode.commands.registerCommand(VscodeCommandEnum.IMPORT_NOVEL, async () => {
        const fileUris = await vscode.window.showOpenDialog({
            canSelectMany: false,
            filters: { 'Text Files': ['txt'] }
        });

        if (fileUris && fileUris[0]) {
            const filePath = fileUris[0].fsPath;
            const title = path.basename(filePath, '.txt');
            const novels = context.globalState.get<Novel[]>(GlobalStateEnum.NOVELS, []);

            if (novels.some(n => n.path === filePath)) {
                vscode.window.showInformationMessage(`Novel "${title}" is already in your library.`);
                return;
            }

            const newNovel: Novel = {
                title,
                path: filePath,
                currentChapter: 0,
                id: getFileMD5(filePath)
            };
            novels.push(newNovel);
            await context.globalState.update(GlobalStateEnum.NOVELS, novels);
            sidebarProvider.refresh();
            vscode.window.showInformationMessage(`Successfully imported "${title}".`);
        }
    }));

    // Register the command to open a chapter from the sidebar
    context.subscriptions.push(vscode.commands.registerCommand(VscodeCommandEnum.OPEN_CHAPTER, async (item: ChapterItem) => {
        // Update the current chapter in the global state
        const novels = context.globalState.get<Novel[]>(GlobalStateEnum.NOVELS, []);
        const novelToUpdate = novels.find(n => n.path === item.novel.path);
        if (novelToUpdate) {
            novelToUpdate.currentChapter = item.chapterIndex;
            await context.globalState.update(GlobalStateEnum.NOVELS, novels);
            sidebarProvider.refresh(); // Refresh sidebar to show new chapter
        }

        viewProvider.loadChapter(item.novel, item.chapterIndex);
    }));

    // Register the command to open current novel
    context.subscriptions.push(vscode.commands.registerCommand(VscodeCommandEnum.SHOW_CURRENT_NOVEL, async () => {
        const lastViewedNovelId = context.globalState.get<string | undefined>(GlobalStateEnum.LAST_VIEWED_NOVEL_ID);
        const novels = context.globalState.get<Novel[]>(GlobalStateEnum.NOVELS, []);
        const novelToShow = novels.find(n => n.id === lastViewedNovelId) || novels[0];

        if (novelToShow) {
            viewProvider.loadChapter(novelToShow, novelToShow.currentChapter);
        } else {
            vscode.window.showInformationMessage("No novels available. Please import a novel first.");
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand(VscodeCommandEnum.SHOW_CURRENT_CHAPTER, (item: NovelItem) => {
        viewProvider.loadChapter(item.novel, item.novel.currentChapter);
    }));

    // Register commands for chapter navigation
    context.subscriptions.push(vscode.commands.registerCommand(VscodeCommandEnum.NEXT_CHAPTER, () => {
        viewProvider.navigateChapter('next');
    }));

    context.subscriptions.push(vscode.commands.registerCommand(VscodeCommandEnum.PREVIOUS_CHAPTER, () => {
        viewProvider.navigateChapter('previous');
    }));

    // Register the command to refresh the sidebar
    context.subscriptions.push(vscode.commands.registerCommand(VscodeCommandEnum.REFRESH_SIDEBAR, () => {
        sidebarProvider.refresh();
    }));

    // Register the command to delete a novel
    context.subscriptions.push(vscode.commands.registerCommand(VscodeCommandEnum.DELETE_NOVEL, async (item: NovelItem) => {
        if (!item) {
            return;
        }
        
        const novelToDelete = item.novel;
        const confirm = await vscode.window.showWarningMessage(
            `Are you sure you want to delete "${novelToDelete.title}" from your library?`,
            { modal: true },
            'Yes'
        );

        if (confirm === 'Yes') {
            let novels = context.globalState.get<Novel[]>(GlobalStateEnum.NOVELS, []);
            novels = novels.filter(n => n.path !== novelToDelete.path);
            await context.globalState.update(GlobalStateEnum.NOVELS, novels);
            sidebarProvider.refresh();
            vscode.window.showInformationMessage(`"${novelToDelete.title}" has been removed.`);
        }
    }));
}

export function deactivate() { }