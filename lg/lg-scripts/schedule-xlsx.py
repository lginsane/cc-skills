#!/usr/bin/env python3
"""schedule-xlsx.py — 将排期 JSON 转为格式化 xlsx"""
import sys, json, os
from datetime import date
from openpyxl import Workbook
from openpyxl.styles import Font, Alignment, Border, Side, PatternFill

def main():
    data = json.load(sys.stdin)
    schedule = data.get("scheduleJSON") or data
    output_dir = data.get("outputDir", ".")
    version = data.get("version", "unknown")
    safe_ver = version.replace("/", "-").replace("\\", "-")

    os.makedirs(output_dir, exist_ok=True)
    today = date.today().isoformat()
    filepath = os.path.join(output_dir, f"V{safe_ver}-前端开发排期表-{today}.xlsx")

    wb = Workbook()
    ws = wb.active
    ws.title = "前端开发排期表"

    # ── 列宽 ──
    for col, w in {"A": 10, "B": 24, "C": 42, "D": 12, "E": 14, "F": 36}.items():
        ws.column_dimensions[col].width = w

    # ── 样式常量 ──
    HDR_FONT  = Font(name="微软雅黑", size=11, bold=True, color="FFFFFF")
    HDR_FILL  = PatternFill(start_color="4472C4", end_color="4472C4", fill_type="solid")
    HDR_ALIGN = Alignment(horizontal="center", vertical="center", wrap_text=True)

    BODY_FONT   = Font(name="微软雅黑", size=10)
    BODY_ALIGN  = Alignment(horizontal="left", vertical="center", wrap_text=True)
    CTR_ALIGN   = Alignment(horizontal="center", vertical="center", wrap_text=True)
    NUM_ALIGN   = Alignment(horizontal="right", vertical="center")

    SUB_FILL = PatternFill(start_color="D6E4F0", end_color="D6E4F0", fill_type="solid")
    SUB_FONT = Font(name="微软雅黑", size=10, bold=True, color="1F4E79")

    TOT_FILL = PatternFill(start_color="2E75B6", end_color="2E75B6", fill_type="solid")
    TOT_FONT = Font(name="微软雅黑", size=11, bold=True, color="FFFFFF")

    BORDER = Border(
        left=Side(style="thin", color="B4C6E7"),
        right=Side(style="thin", color="B4C6E7"),
        top=Side(style="thin", color="B4C6E7"),
        bottom=Side(style="thin", color="B4C6E7"),
    )

    # ── 标题行 ──
    ws.merge_cells("A1:F1")
    c = ws["A1"]
    c.value = f"V{version}  前端开发排期表"
    c.font = Font(name="微软雅黑", size=15, bold=True, color="1F4E79")
    c.alignment = Alignment(horizontal="center", vertical="center")
    ws.row_dimensions[1].height = 38

    ws.merge_cells("A2:F2")
    c = ws["A2"]
    c.value = f"生成时间: {today}"
    c.font = Font(name="微软雅黑", size=9, color="808080")
    c.alignment = Alignment(horizontal="center", vertical="center")
    ws.row_dimensions[2].height = 24
    ws.row_dimensions[3].height = 8

    # ── 表头 ──
    headers = ["端", "菜单", "任务拆解", "负责人", "预计工时(h)", "备注"]
    for i, h in enumerate(headers, 1):
        c = ws.cell(row=4, column=i, value=h)
        c.font = HDR_FONT
        c.fill = HDR_FILL
        c.alignment = HDR_ALIGN
        c.border = BORDER
    ws.row_dimensions[4].height = 30

    row = 5

    for duan in schedule.get("端", []):
        duan_name = duan.get("name", "")
        duan_start = row

        for menu in duan.get("菜单", []):
            menu_name = menu.get("name", "")
            menu_start = row

            for task in menu.get("任务", []):
                ws.cell(row=row, column=1, value="").font = BODY_FONT
                ws.cell(row=row, column=2, value="").font = BODY_FONT
                ws.cell(row=row, column=3, value=task.get("name", "")).font = BODY_FONT
                ws.cell(row=row, column=4, value=task.get("assignee", "")).font = BODY_FONT
                c = ws.cell(row=row, column=5, value=task.get("hours", 0))
                c.font = BODY_FONT; c.alignment = NUM_ALIGN; c.number_format = '0.0'
                ws.cell(row=row, column=6, value=task.get("reason", "")).font = BODY_FONT
                for col in range(1, 7):
                    ws.cell(row=row, column=col).border = BORDER
                    if col in (3, 6):
                        ws.cell(row=row, column=col).alignment = BODY_ALIGN
                    elif col in (1, 2, 4):
                        ws.cell(row=row, column=col).alignment = CTR_ALIGN
                ws.row_dimensions[row].height = 26
                row += 1

            menu_end = row - 1

            if menu_end >= menu_start:
                ws.merge_cells(start_row=menu_start, start_column=2, end_row=menu_end, end_column=2)
                ws.cell(row=menu_start, column=2).value = menu_name
                ws.cell(row=menu_start, column=2).alignment = CTR_ALIGN
                ws.cell(row=menu_start, column=2).font = BODY_FONT

            # 小计行
            for col in range(1, 7):
                ws.cell(row=row, column=col).fill = SUB_FILL
                ws.cell(row=row, column=col).font = SUB_FONT
                ws.cell(row=row, column=col).border = BORDER
            ws.merge_cells(start_row=row, start_column=2, end_row=row, end_column=4)
            ws.cell(row=row, column=2).value = f"{menu_name} 小计"
            ws.cell(row=row, column=2).alignment = CTR_ALIGN
            c = ws.cell(row=row, column=5, value=menu.get("subtotalHours", 0))
            c.alignment = NUM_ALIGN; c.number_format = '0.0'
            ws.row_dimensions[row].height = 28
            row += 1

        duan_end = row - 1

        if duan_end >= duan_start:
            ws.merge_cells(start_row=duan_start, start_column=1, end_row=duan_end, end_column=1)
            ws.cell(row=duan_start, column=1).value = duan_name
            ws.cell(row=duan_start, column=1).alignment = CTR_ALIGN
            ws.cell(row=duan_start, column=1).font = BODY_FONT

        # 总计行
        for col in range(1, 7):
            ws.cell(row=row, column=col).fill = TOT_FILL
            ws.cell(row=row, column=col).font = TOT_FONT
            ws.cell(row=row, column=col).border = BORDER
        ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=4)
        ws.cell(row=row, column=1).value = f"{duan_name}  总计"
        ws.cell(row=row, column=1).alignment = CTR_ALIGN
        c = ws.cell(row=row, column=5, value=duan.get("totalHours", 0))
        c.alignment = NUM_ALIGN; c.number_format = '0.0'
        ws.row_dimensions[row].height = 32
        row += 1

    ws.freeze_panes = "A5"
    wb.save(filepath)

    # 同时保存 JSON 备份
    json_path = filepath.replace(".xlsx", ".json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(schedule, f, ensure_ascii=False, indent=2)

    print(json.dumps({"success": True, "filePath": filepath, "jsonPath": json_path}, ensure_ascii=False))

if __name__ == "__main__":
    main()
