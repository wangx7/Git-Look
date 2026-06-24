import './mock-vscode';
import { getCommits, getBranches, getAuthors } from '../src/gitHelper';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
    const gitRoot = process.cwd();
    const commitsResult = await getCommits(gitRoot, {}, 0, 50, new AbortController().signal);
    const branches = await getBranches(gitRoot);
    const authors = await getAuthors(gitRoot);
    const data = {
        type: 'dataLoaded',
        page: 0,
        commits: commitsResult,
        branches: branches,
        remoteBranches: [],
        authors: authors
    };
    fs.writeFileSync('public/mockData.js', `window.mockData = ${JSON.stringify(data)};`);
    console.log('Mock data generated at public/mockData.js');
}

main().catch(console.error);
