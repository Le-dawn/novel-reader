import * as fs from 'fs';
import * as jschardet from 'jschardet';
import * as iconv from 'iconv-lite';

export function readTextFileWithAutoEncoding(filePath: string): string {
    try {
        // Read the file as binary buffer
        const buffer = fs.readFileSync(filePath);

        // Detect encoding
        const detected = jschardet.detect(buffer);
        const encoding = detected.encoding.toLowerCase();

        // If encoding is utf-8 or ascii, use native fs.readFileSync
        if (encoding === 'utf-8' || encoding === 'ascii') {
            return fs.readFileSync(filePath, 'utf8');
        }

        // For other encodings like gbk, use iconv-lite
        if (iconv.encodingExists(encoding)) {
            return iconv.decode(buffer, encoding);
        }

        // Fallback to utf-8 if encoding is not supported
        return iconv.decode(buffer, 'utf-8');
    } catch (error) {
        console.error(`Error detecting encoding for file ${filePath}:`, error);
        // Fallback to UTF-8 if encoding detection fails
        try {
            return fs.readFileSync(filePath, 'utf8');
        } catch (utf8Error) {
            console.error(`Error reading file ${filePath} as UTF-8:`, utf8Error);
            throw new Error(`Unable to read file ${filePath}: ${error}`);
        }
    }
}