/**
 * PDF & Chart generation code templates.
 * These are injected into the system prompt when PDF generation is needed.
 */

/* eslint-disable no-useless-escape */

export const SKILL_PDF_GENERATION = `## Loaded Skill: PDF & Chart Generation (Chinese Content)

**CRITICAL**: Use matplotlib + PdfPages for ALL PDF generation with Chinese text. NEVER use fpdf2 for Chinese.
When generating PDF or charts, follow the templates below exactly — only change the data/content.

### Template 1: Data Report PDF (表格 + 图表 + 多页)

\\\`\\\`\\\`python
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.backends.backend_pdf import PdfPages
from matplotlib.font_manager import FontProperties
import numpy as np

# Font setup — MUST use this for Chinese
font = FontProperties(fname='/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc')
font_bold = FontProperties(fname='/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', weight='bold')

# Professional color palette
COLORS = ['#2563eb', '#dc2626', '#16a34a', '#ca8a04', '#9333ea', '#0891b2', '#e11d48', '#4f46e5']

with PdfPages('/tmp/report.pdf') as pdf:
    # === Page 1: Cover ===
    fig, ax = plt.subplots(figsize=(8.27, 11.69))
    ax.axis('off')
    ax.add_patch(plt.Rectangle((0, 0.85), 1, 0.15, transform=ax.transAxes, color='#1e40af', zorder=0))
    ax.text(0.5, 0.92, '数据分析报告', fontsize=28, fontproperties=font_bold, ha='center', va='center', color='white')
    ax.text(0.5, 0.78, '报告副标题 / 数据来源', fontsize=14, fontproperties=font, ha='center', color='#374151')
    ax.text(0.5, 0.72, '生成日期: 2025-05-27', fontsize=10, fontproperties=font, ha='center', color='#6b7280')
    pdf.savefig(fig); plt.close()

    # === Page 2: Data Table ===
    fig, ax = plt.subplots(figsize=(8.27, 11.69))
    ax.axis('off')
    ax.text(0.5, 0.96, '数据明细', fontsize=18, fontproperties=font_bold, ha='center', va='top')

    # Table data — replace with actual data
    col_labels = ['产品', 'Q1', 'Q2', 'Q3', 'Q4']
    table_data = [
        ['产品A', '$45K', '$52K', '$61K', '$72K'],
        ['产品B', '$85K', '$95K', '$110K', '$128K'],
    ]
    table = ax.table(cellText=table_data, colLabels=col_labels, loc='center', cellLoc='center')
    table.auto_set_font_size(False)
    table.set_fontsize(9)
    table.scale(1, 1.6)
    # Style header
    for j in range(len(col_labels)):
        table[0, j].set_facecolor('#1e40af')
        table[0, j].set_text_props(color='white', fontproperties=font_bold)
    # Style cells
    for i in range(1, len(table_data) + 1):
        for j in range(len(col_labels)):
            table[i, j].set_text_props(fontproperties=font)
            table[i, j].set_facecolor('#f8fafc' if i % 2 == 0 else 'white')
    pdf.savefig(fig); plt.close()

    # === Page 3: Bar Chart ===
    fig, ax = plt.subplots(figsize=(8.27, 6))
    categories = ['产品A', '产品B', '产品C', '产品D']
    values = [72, 128, 51, 95]
    bars = ax.bar(categories, values, color=COLORS[:len(categories)], width=0.6, edgecolor='white', linewidth=0.5)
    ax.set_title('各产品 Q4 营收 (千元)', fontproperties=font_bold, fontsize=14, pad=15)
    ax.set_ylabel('营收 ($K)', fontproperties=font, fontsize=10)
    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)
    ax.set_xticks(range(len(categories)))
    ax.set_xticklabels(categories, fontproperties=font, fontsize=9)
    for bar, v in zip(bars, values):
        ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 1, f'{v}K', ha='center', fontsize=9, fontproperties=font)
    plt.tight_layout()
    pdf.savefig(fig); plt.close()

print("PDF generated: /tmp/report.pdf")
\\\`\\\`\\\`

### Template 2: Charts Only (独立图表图片)

\\\`\\\`\\\`python
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.font_manager import FontProperties
import numpy as np

font = FontProperties(fname='/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc')
font_bold = FontProperties(fname='/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', weight='bold')
COLORS = ['#2563eb', '#dc2626', '#16a34a', '#ca8a04', '#9333ea', '#0891b2']

# --- Line Chart (趋势图) ---
fig, ax = plt.subplots(figsize=(10, 5))
quarters = ['Q1', 'Q2', 'Q3', 'Q4']
products = {'产品A': [45, 52, 61, 72], '产品B': [85, 95, 110, 128], '产品C': [15, 42, 68, 95]}
for i, (name, data) in enumerate(products.items()):
    ax.plot(quarters, data, marker='o', linewidth=2.5, markersize=8, color=COLORS[i], label=name)
ax.set_title('季度营收趋势', fontproperties=font_bold, fontsize=16, pad=15)
ax.set_ylabel('营收 (千元)', fontproperties=font, fontsize=11)
ax.legend(prop=font, framealpha=0.9, loc='upper left')
ax.grid(True, alpha=0.3, linestyle='--')
ax.spines['top'].set_visible(False)
ax.spines['right'].set_visible(False)
plt.tight_layout()
plt.savefig('/tmp/chart_trend.png', dpi=150, bbox_inches='tight')
plt.close()

# --- Pie Chart (占比图) ---
fig, ax = plt.subplots(figsize=(7, 7))
labels = ['企业版', '中小企业', '个人版']
sizes = [50, 30, 20]
explode = (0.03, 0, 0)
wedges, texts, autotexts = ax.pie(sizes, explode=explode, labels=labels, colors=COLORS[:3], autopct='%1.1f%%', startangle=90, textprops={'fontproperties': font, 'fontsize': 12})
for at in autotexts:
    at.set_fontproperties(font_bold)
    at.set_fontsize(13)
ax.set_title('收入结构分布', fontproperties=font_bold, fontsize=16, pad=20)
plt.tight_layout()
plt.savefig('/tmp/chart_pie.png', dpi=150, bbox_inches='tight')
plt.close()

print("Charts saved: /tmp/chart_trend.png, /tmp/chart_pie.png")
\\\`\\\`\\\`

### Template 3: Multi-File Merge PDF (多文件合并报告)

\\\`\\\`\\\`python
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.backends.backend_pdf import PdfPages
from matplotlib.font_manager import FontProperties
import textwrap

font = FontProperties(fname='/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc')
font_bold = FontProperties(fname='/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', weight='bold')

def add_text_page(pdf, title, content, subtitle=None):
    fig, ax = plt.subplots(figsize=(8.27, 11.69))
    ax.axis('off')
    ax.add_patch(plt.Rectangle((0, 0.94), 1, 0.06, transform=ax.transAxes, color='#1e40af'))
    ax.text(0.04, 0.97, title, fontsize=16, fontproperties=font_bold, va='center', color='white')
    if subtitle:
        ax.text(0.96, 0.97, subtitle, fontsize=9, fontproperties=font, va='center', ha='right', color='#93c5fd')
    y = 0.90
    for line in content.split('\\n'):
        wrapped = textwrap.wrap(line, width=50) or ['']
        for wl in wrapped:
            if y < 0.05: break
            ax.text(0.04, y, wl, fontsize=10, fontproperties=font, va='top', color='#1f2937')
            y -= 0.025
        y -= 0.008
    pdf.savefig(fig); plt.close()

with PdfPages('/tmp/merged_report.pdf') as pdf:
    # Cover
    fig, ax = plt.subplots(figsize=(8.27, 11.69))
    ax.axis('off')
    ax.add_patch(plt.Rectangle((0, 0), 1, 1, transform=ax.transAxes, color='#0f172a'))
    ax.text(0.5, 0.55, '综合分析报告', fontsize=32, fontproperties=font_bold, ha='center', color='white')
    ax.text(0.5, 0.45, '多文件整合 · 数据洞察', fontsize=14, fontproperties=font, ha='center', color='#94a3b8')
    pdf.savefig(fig); plt.close()

    # Add pages for each file
    add_text_page(pdf, '文件 1: 季度报告', '此处放入文件内容...', 'quarterly-report.txt')
    add_text_page(pdf, '文件 2: 项目计划', '此处放入文件内容...', 'project-plan.md')

print("Merged PDF: /tmp/merged_report.pdf")
\\\`\\\`\\\`

### Instructions for using templates:
- **ALWAYS copy the font setup exactly** — do not change the font path or use other fonts
- **Replace data variables** with actual file content read via code_interpreter
- **Keep the color palette** (COLORS array) for consistency
- **fpdf2 is ONLY for English-only text** with Helvetica font. For ANY Chinese content, use matplotlib.
- After generating, IMMEDIATELY call deliver_file. Do NOT verify the PDF.
`;
