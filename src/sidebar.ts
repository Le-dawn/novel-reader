import * as vscode from 'vscode';
import * as fs from 'fs';
import { parseChapters } from './chapterParser';
import { GlobalStateEnum } from './globalStateEnum';

// Define the structure for a novel object
export interface Novel {
    id?: string; // 可选的MD5 ID字段
    title: string;
    path: string;
    currentChapter: number;
}

// A union type for the TreeDataProvider
type TreeItem = NovelItem | ChapterItem;

export class NovelSidebarProvider implements vscode.TreeDataProvider<TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<TreeItem | undefined | null | void> = new vscode.EventEmitter<TreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor(private context: vscode.ExtensionContext) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: TreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: TreeItem): Thenable<TreeItem[]> {
        if (element instanceof NovelItem) {
            // If the element is a NovelItem, return its chapters
            try {
                const novelText = fs.readFileSync(element.novel.path, 'utf-8');
                const chapters = parseChapters(novelText);
                return Promise.resolve(
                    chapters.map((chapter, index) => new ChapterItem(chapter.title, element.novel, index))
                );
            } catch (e) {
                vscode.window.showErrorMessage("Failed to read novel chapters.");
                return Promise.resolve([]);
            }
        } else {
            // Otherwise, return the list of novels (top-level)
            const novels = this.context.globalState.get<Novel[]>(GlobalStateEnum.NOVELS, []);
            return Promise.resolve(novels.map(novel => new NovelItem(novel)));
        }
    }
}

export class NovelItem extends vscode.TreeItem {
    constructor(public readonly novel: Novel) {
        super(novel.title, vscode.TreeItemCollapsibleState.Collapsed);
        this.tooltip = `${novel.path}`;
        this.description = `Chapter ${novel.currentChapter + 1}`;
        this.contextValue = 'novelItem'; // Used for context menus in package.json
    }
}

export class ChapterItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly novel: Novel,
        public readonly chapterIndex: number
    ) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.tooltip = `Chapter ${chapterIndex + 1}`;
        
        // Command to execute when the chapter is clicked
        this.command = {
            command: 'novelReader.openChapter',
            title: 'Open Chapter',
            arguments: [this],
        };
    }
}
