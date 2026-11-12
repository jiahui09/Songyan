---
title: 纸上阅读 · Markdown 与图片验证
date: 2026-10-10 16:41:33
tags:
  - 排版
categories:
  - 技术
---

## 段落与文字层次

这是实际 Markdown 解析的正文，不是手写的展示 HTML。**重点文字**、*语气强调*、~~修订文字~~、`inlineCode()` 与 [内部归档](/archives/) 共用同一阅读层。

长路径 `source/notes/typography/a-very-long-unbroken-filename-for-mobile-reading.md` 不应撑破版心。

### 多级标题

标题与正文保留清楚的层次。

#### 四级标题

列表中的段落不应继承文学首行缩进。

> 引用中的第一段。
>
> 第二段引用与正文有别。

1. 整理内容。
   - 确认嵌套关系。
   - 保留列表标记。
2. 检查不同屏幕。

- [x] 段落与列表
- [ ] 发布前复核内容

| 元素 | 呈现原则 | 窄屏行为 |
| --- | --- | --- |
| 正文 | 自然换行 | 保留字号 |
| 代码与表格 | 内容完整 | 局部横向滚动 |
| 图片 | 保持比例 | 不超出版心 |

```css
.reading-body {
  color: var(--ink);
  line-height: 2;
}
```

```javascript
// 阅读样张：复制时不包含行号。
const reading = {
  layout: 'single-column',
  content: ['诗词', '随笔', '技术', '项目'],
  image: {
    preserveRatio: true,
    upscale: false,
    watermark: 'opt-in'
  },
  typography: {
    paper: 'shared',
    prose: 'readable',
    poetry: 'stanza-aware'
  }
};

function describeReading(value) {
  return value.content.join(' · ');
}

const path = 'source/notes/typography/a-long-code-line-that-stays-in-its-own-scroll-container/example.md';
console.log(describeReading(reading), path);
```

## 图片与图注

![竖幅山形比例样图](/images/reading-portrait.svg)

![小尺寸宣纸纹理](/images/paper-texture.png)

<figure class="reading-image-surface">
<img src="/images/reading-diagram.svg" width="640" height="160" alt="透明底图表：内容、结构与阅读" loading="lazy" decoding="async">
<figcaption>原始比例与图注验证，不自动覆盖水印。</figcaption>
</figure>

<aside class="reading-footnotes" aria-label="注释"><p id="note-example">注释样例，保留 HTML 锚点和语义结构。</p></aside>
