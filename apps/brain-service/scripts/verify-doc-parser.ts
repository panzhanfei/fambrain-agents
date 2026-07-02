/**
 * DocParser 格式检测与 Markdown 构建单测（不依赖 Ollama / 解析库 IO）。
 *
 *   pnpm run verify:doc-parser
 */
import assert from "node:assert/strict";
import { buildCorpusMarkdown, buildOutputPaths, detectDocFormat, getDocParseConcurrency, isSupportedDocFile, resolveCorpusCategory, slugifyBaseName, } from "../src/agentflow/brain-service/offline/doc-parser/index";
const testFormats = () => {
    assert.equal(detectDocFormat("report.pdf"), "pdf");
    assert.equal(detectDocFormat("notes.docx"), "word");
    assert.equal(detectDocFormat("deck.pptx"), "ppt");
    assert.equal(detectDocFormat("scan.PNG"), "image");
    assert.equal(detectDocFormat("readme.txt"), "unsupported");
    assert.equal(isSupportedDocFile("a.pdf"), true);
    assert.equal(isSupportedDocFile("a.txt"), false);
};
const testSlug = () => {
    assert.equal(slugifyBaseName("我的 简历.pdf"), "我的-简历");
    assert.equal(slugifyBaseName("---.pdf"), "document");
};
const testPaths = () => {
    const paths = buildOutputPaths("u1", "u2", "projects", "Demo File.pdf");
    assert.match(paths.vaultRelativePath, /^users\/u1\/vault\/originals\/uploads\//);
    assert.match(paths.corpusRelativePath, /^users\/u2\/corpus\/projects\/imports\//);
    assert.ok(paths.mdFileName.endsWith(".md"));
};
const testMarkdown = () => {
    const md = buildCorpusMarkdown({
        fileName: "a.pdf",
        format: "pdf",
        title: "Demo",
        text: "hello",
        vaultRelativePath: "users/u/vault/originals/uploads/a.pdf",
        corpusRelativePath: "users/u/corpus/personal/imports/a.md",
    });
    assert.match(md, /^# Demo/);
    assert.match(md, /hello/);
};
const testConcurrencyDefault = () => {
    const prev = process.env.DOC_PARSE_CONCURRENCY;
    delete process.env.DOC_PARSE_CONCURRENCY;
    assert.equal(getDocParseConcurrency(), 2);
    process.env.DOC_PARSE_CONCURRENCY = prev;
};
const testCategoryResolution = () => {
    assert.equal(resolveCorpusCategory({
        fileName: "foo.pdf",
        relativePath: "batch/projects/platform-v2/spec.pdf",
    }), "projects");
    assert.equal(resolveCorpusCategory({
        fileName: "resume.pdf",
        title: "张三个人简历",
    }), "personal");
    assert.equal(resolveCorpusCategory({
        fileName: "work.pdf",
        textSnippet: "2019-2023 在某公司担任高级工程师",
    }), "experience");
    assert.equal(resolveCorpusCategory({ fileName: "notes.pdf" }), "personal");
};
const main = () => {
    testFormats();
    testSlug();
    testPaths();
    testMarkdown();
    testConcurrencyDefault();
    testCategoryResolution();
    console.log("doc-parser 单测通过。");
};
main();
