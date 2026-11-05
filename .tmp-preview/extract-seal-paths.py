# -*- coding: utf-8 -*-
"""一次性抽字:开元小篆 KaiyuanSeal.ttf -> 站点印章字形数据集 (整数精度 SVG path)

构建期工具草稿(不入库)。输出 themes/hexo-theme-songyan/lib/seal-glyphs.json。
授权:SIL OFL 1.1 (Kaiyuan Small Seal Font Contributors) — 网页渲染子集化/格式转换特例。
"""
import sys, json, re, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'pylibs'))
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TTF = os.path.join(ROOT, '.tmp-preview', 'KaiyuanSeal.ttf')
SEALSRC = os.path.join(ROOT, '.tmp-preview', 'SealSources.txt')
OUT = os.path.join(ROOT, 'themes', 'hexo-theme-songyan', 'lib', 'seal-glyphs.json')

font = TTFont(TTF)
cmap = font.getBestCmap()
glyphSet = font.getGlyphSet()
upem = font['head'].unitsPerEm
hhea = font['hhea']
hmtx = font['hmtx'].metrics

# 现代汉字 -> 篆书区码位 (SealSources kSEAL_MCJK, 取首个)
rev = {}
with open(SEALSRC, encoding='utf-8') as fh:
    for line in fh:
        if line.startswith('#'):
            continue
        p = line.rstrip('\n').split('\t')
        if len(p) == 3 and p[1] == 'kSEAL_MCJK':
            try:
                rev.setdefault(chr(int(p[2], 16)), int(p[0][2:], 16))
            except ValueError:
                pass

# 别名:说文本字/古字(仅收考证确凿者)
ALIAS = {'春': '萅'}

# 候选集(重复自动去重;解析失败自动剔除并记日志)
CANDIDATES = ''.join([
    # 站点印文
    '春唇语冬词韵东坡居士春萅唇語冬詞韻東',
    # 干支
    '甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥',
    # 生肖
    '鼠牛虎兔龙蛇马羊猴鸡狗猪龍馬雞豬',
    # 五行 五方 五色
    '金木水火土东南西北中東南青白黄赤黑黃',
    # 二十四节气用字
    '立春雨水惊蛰分清明谷小满芒种夏暑处秋冬寒露霜降雪大至',
    # 吉语
    '福禄寿喜安康如意吉祥长生无极千秋万岁金玉满堂紫气东来祿壽長極歲氣來壽',
    # 文人文房
    '诗书琴棋画松竹梅兰菊石云风月山水湖海詩書畫雲風蘭齋閣樓臺廬莊煙霞酒茶香剑禅隐逸仙道剑禪隱處士主先生山人居士和靖',
    # 虚词助语
    '之乎者也矣焉哉其以而为之不无有天人大上下中無為',
    # 数字与时间
    '一二三四五六七八九十百千万亿年萬億日月星辰光陰辰光',
    # 姓氏 前 60
    '李王张刘陈杨赵黄周吴徐孙马朱胡郭何高林罗郑梁谢宋唐许韩冯邓曹彭曾肖田董袁潘于蒋蔡余杜叶程苏魏吕丁任沈姚卢姜崔钟谭陆汪范金石廖贾夏韦方白邹孟熊秦邱江尹薛段雷侯龙史陶黎贺顾毛郝龚邵万钱严武戴莫孔向汤張劉陳楊趙黃吳孫馬朱鄭謝韓馮鄧曹彭董蔣蔡葉蘇魏鐘羅嚴萬龍',
    # 词牌与诗意常用
    '念奴娇沁园春疏影暗香浮莲芙蕖蘋藻砚笔耕田窗扉篱落黄昏细雨梧桐芭蕉残荷听雪煮酒论英雄',
])

seen, ordered = set(), []
for ch in CANDIDATES:
    if ch not in seen:
        seen.add(ch)
        ordered.append(ch)

glyphs, adv, unresolved = {}, {}, []
for ch in ordered:
    key = ALIAS.get(ch, ch)
    cp = rev.get(key)
    if cp is None or cp not in cmap:
        unresolved.append(ch)
        continue
    gname = cmap[cp]
    pen = SVGPathPen(glyphSet)
    glyphSet[gname].draw(pen)
    d = pen.getCommands()
    # 整数化(upem 千分位精度,44px 渲染下误差 <0.05px,肉眼不可辨)
    d = re.sub(r'-?\d+\.?\d*', lambda m: str(int(round(float(m.group(0))))), d)
    d = d.replace('-0', '0')
    glyphs[ch] = d
    adv[gname] = hmtx[gname][0]

uniform_adv = len(set(adv.values())) == 1
meta = {
    'upem': upem,
    'ascent': hhea.ascent,
    'descent': hhea.descent,
    'source': 'Kaiyuan Small Seal Font (KaiyuanSeal.ttf)',
    'license': 'SIL OFL 1.1, Copyright (c) 2026 Kaiyuan Small Seal Font Contributors, github.com/frankslin/kaiyuan-small-seal-font; glyphs extracted for web rendering only',
    'count': len(glyphs),
}

# advance 非全等时才内嵌逐字步进
out = {'_meta': meta, 'glyphs': glyphs}
if not uniform_adv:
    out['adv'] = {ch: adv[cmap[rev.get(ALIAS.get(ch, ch))]] for ch in glyphs}
    meta['uniformAdvance'] = False
else:
    meta['uniformAdvance'] = True

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, 'w', encoding='utf-8') as fh:
    json.dump(out, fh, ensure_ascii=False, separators=(',', ':'), sort_keys=True)

size = os.path.getsize(OUT)
print(f'candidates={len(ordered)} kept={len(glyphs)} unresolved={len(unresolved)}')
print(f'unresolved chars: {"".join(unresolved)}')
print(f'uniform_advance={uniform_adv} ascent={hhea.ascent} descent={hhea.descent} upem={upem}')
print(f'out: {OUT} ({size/1024:.0f} KB)')
