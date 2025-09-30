export function parseChapters(text: string): { title: string, content: string }[] {
    if (!text) {
        return [];
    }

    // This improved regex is designed to be more robust.
    // It looks for lines starting with "第" followed by numbers/Chinese numerals and "章", or "Chapter" followed by numbers.
    // It captures the entire chapter title line.
    const regex = /(^\s*(第[零一二三四五六七八九十百千万\d\s]+章)[^\n]*|^\s*(Chapter\s+\d+)[^\n]*)/m;

    const lines = text.split('\n');
    const chapters: { title: string, content: string }[] = [];
    let currentChapterContent: string[] = [];
    let currentTitle: string | null = null;

    for (const line of lines) {
        if (regex.test(line)) {
            // When a new chapter title is found, push the previous chapter's content
            if (currentTitle) {
                chapters.push({ title: currentTitle, content: currentChapterContent.join('\n').trim() });
            }
            // Start a new chapter
            currentTitle = line.trim();
            currentChapterContent = [];
        } else {
            // If we haven't found the first chapter title yet, skip the content
            if (currentTitle) {
                currentChapterContent.push(line);
            }
        }
    }

    // Add the last chapter
    if (currentTitle) {
        chapters.push({ title: currentTitle, content: currentChapterContent.join('\n').trim() });
    }

    // If no chapters were found at all, return the entire text as a single "chapter"
    if (chapters.length === 0 && text.trim()) {
        return [{ title: 'Full Text', content: text.trim() }];
    }

    return chapters;
}