"""Reproduce the educational COCOMO II / CPM / resource schedule.

Run from repository root: python tools/estimate_plan.py
Requires matplotlib for charts. No app build or external API calls are made.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyArrowPatch, FancyBboxPatch
from matplotlib import font_manager

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "planning"
INPUT = json.loads((OUT / "model_inputs.json").read_text(encoding="utf-8"))


def calculate(data):
    c = data["constants"]
    e = c["B"] + 0.01 * sum(s["value"] for s in data["scale_factors"])
    eaf = math.prod(s["value"] for s in data["effort_multipliers"])
    sced = next(s["value"] for s in data["effort_multipliers"] if s["id"] == "SCED")
    f = c["D"] + 0.2 * (e - c["B"])
    scenarios = []
    for size in data["size_scenarios_ksloc"]:
        pm_ns = c["A"] * size ** e * (eaf / sced)
        pm = pm_ns * sced
        hours = pm * data["hours_per_pm"]
        scenarios.append(dict(ksloc=size, pm=pm, hours=hours,
                              example_labor_krw=hours * data["hourly_rate_krw"],
                              solo_weeks=hours / data["weekly_hours"],
                              tdev_months=c["C"] * pm_ns ** f * data["sced_percent"] / 100))
    base = next(s for s in scenarios if s["ksloc"] == data["baseline_ksloc"])
    # Top-down allocation; these are NOT independent task effort estimates.
    main_hours = math.ceil(base["hours"])
    weighted = [t for t in data["tasks"] if t["scope"] == "cocomo"]
    assert sum(t["weight"] for t in weighted) == 100
    assert sum(m["sloc"] for m in data["size_breakdown"]) == data["baseline_ksloc"] * 1000
    allocations = {t["id"]: math.floor(main_hours * t["weight"] / 100) for t in weighted}
    remaining = main_hours - sum(allocations.values())
    by_fraction = sorted(weighted, key=lambda t: -(main_hours * t["weight"] / 100 % 1))
    for task in by_fraction[:remaining]:
        allocations[task["id"]] += 1

    tasks = {t["id"]: dict(t) for t in data["tasks"]}
    order = data["resource_order"]
    assert set(order) == set(tasks) and len(order) == len(set(order))
    seen = set()
    for key in order:
        t = tasks[key]
        assert set(t["deps"]) <= seen, f"Invalid topological order: {key}"
        t["hours"] = allocations[key] if t["scope"] == "cocomo" else t["fixed_hours"]
        t["duration_weeks"] = t["hours"] / data["weekly_hours"]
        t["es"] = max((tasks[d]["ef"] for d in t["deps"]), default=0)
        t["ef"] = t["es"] + t["duration_weeks"]
        seen.add(key)
    finish = max(t["ef"] for t in tasks.values())
    for key in reversed(order):
        t = tasks[key]
        successors = [s for s in tasks.values() if key in s["deps"]]
        t["lf"] = min((s["ls"] for s in successors), default=finish)
        t["ls"] = t["lf"] - t["duration_weeks"]
        t["float"] = max(0, t["ls"] - t["es"])
        t["critical"] = t["float"] < 1e-8
    cursor = 0
    for key in order:
        t = tasks[key]
        t["resource_start"] = max(cursor, max((tasks[d]["resource_finish"] for d in t["deps"]), default=0))
        t["resource_finish"] = t["resource_start"] + t["duration_weeks"]
        cursor = t["resource_finish"]
    for t in tasks.values():
        assert t["es"] <= t["ls"] + 1e-8
        assert all(t["resource_start"] >= tasks[d]["resource_finish"] - 1e-8 for d in t["deps"])
    assert math.isclose(sum(tasks[k]["hours"] for k in allocations), main_hours)
    assert math.isclose(cursor * data["weekly_hours"], sum(t["hours"] for t in tasks.values()))
    critical_paths = []
    def visit(key, path):
        successors = [s for s in tasks.values() if key in s["deps"] and s["critical"]
                      and math.isclose(tasks[key]["ef"], s["es"])]
        if not successors:
            if math.isclose(tasks[key]["ef"], finish):
                critical_paths.append(path)
            return
        for successor in successors:
            visit(successor["id"], path + [successor["id"]])
    for key in order:
        if not tasks[key]["deps"] and tasks[key]["critical"]:
            visit(key, [key])
    assert all(math.isclose(sum(tasks[key]["duration_weeks"] for key in path), finish)
               for path in critical_paths)
    return dict(exponent=e, schedule_exponent=f, eaf=eaf, scenarios=scenarios,
                baseline=base, main_rounded_hours=main_hours, tasks=list(tasks.values()),
                cpm_weeks=finish, solo_weeks=cursor,
                total_hours=sum(t["hours"] for t in tasks.values()),
                critical_paths=critical_paths)


def charts(result):
    installed = {f.name for f in font_manager.fontManager.ttflist}
    plt.rcParams["font.family"] = "Malgun Gothic" if "Malgun Gothic" in installed else "DejaVu Sans"
    plt.rcParams["axes.unicode_minus"] = False
    plt.rcParams["svg.fonttype"] = "path"
    tasks = result["tasks"]
    fig, ax = plt.subplots(figsize=(15, 9))
    for index, t in enumerate(tasks):
        color = "#2563eb" if t["scope"] == "cocomo" else "#64748b"
        ax.barh(index, t["duration_weeks"], left=t["resource_start"], height=.62, color=color)
        ax.text(t["resource_finish"] + .5, index, f'{t["hours"]}h', va="center", fontsize=9)
    ax.set_yticks(range(len(tasks)), [f'{t["id"]}  {t["name"]}' for t in tasks])
    ax.invert_yaxis()
    ax.set_xlim(0, result["solo_weeks"] + 6)
    ax.set_xticks(range(0, math.ceil(result["solo_weeks"]) + 1, 5))
    ax.set_xlabel("프로젝트 시작 후 경과 주 — 실제 시작일 미정")
    ax.set_title(f'1인 · 주 {INPUT["weekly_hours"]}시간 간트 차트 | {result["total_hours"]:,}h / {result["solo_weeks"]:.2f}주', loc="left", fontsize=15, pad=22)
    ax.grid(axis="x", alpha=.2)
    ax.set_axisbelow(True)
    fig.text(.02, .015, "교육용 초안 | 파랑: COCOMO 공수 배분 / 회색: 모델 밖 별도 공수 | 담당자는 모든 작업에서 동일한 1인", fontsize=10)
    fig.tight_layout(rect=(0, .04, 1, 1))
    fig.savefig(OUT / "gantt.png", dpi=170)
    fig.savefig(OUT / "gantt.svg")
    plt.close(fig)

    positions = {"P": (0, 1), "R": (1, 2), "E": (1, 0), "A": (2, 2), "B": (2, 0),
                 "C": (3, 1), "D": (4, 2), "F": (5, 2), "G": (6, 2),
                 "H": (7, 3), "I": (7, 1.5), "J": (7, 0), "K": (5, -1),
                 "L": (8, 2), "M": (9, 2), "N": (10, 2), "Z": (11, 2)}
    lookup = {t["id"]: t for t in tasks}
    fig, ax = plt.subplots(figsize=(27, 9))
    box_w, box_h = .88, .82
    for t in tasks:
        x, y = positions[t["id"]]
        for dep in t["deps"]:
            px, py = positions[dep]
            is_critical = t["critical"] and lookup[dep]["critical"] and math.isclose(lookup[dep]["ef"], t["es"])
            arrow = FancyArrowPatch((px + box_w/2, py), (x - box_w/2, y), arrowstyle="-|>",
                                    mutation_scale=15, color="#dc2626" if is_critical else "#94a3b8",
                                    linewidth=2 if is_critical else 1.2,
                                    connectionstyle="arc3,rad=0.08" if abs(y-py) > 1 else "arc3,rad=0")
            ax.add_patch(arrow)
    for t in tasks:
        x, y = positions[t["id"]]
        color = "#dc2626" if t["critical"] else "#64748b"
        box = FancyBboxPatch((x-box_w/2, y-box_h/2), box_w, box_h,
                             boxstyle="round,pad=0.02", edgecolor=color,
                             facecolor="#fff1f2" if t["critical"] else "#f8fafc", linewidth=1.7)
        ax.add_patch(box)
        ax.text(x, y+.2, f'{t["id"]}  {t["hours"]}h / {t["duration_weeks"]:.2f}주', ha="center", va="center", fontsize=10, weight="bold")
        ax.text(x, y, f'ES {t["es"]:.2f}  EF {t["ef"]:.2f}', ha="center", va="center", fontsize=9)
        ax.text(x, y-.2, f'LS {t["ls"]:.2f}  LF {t["lf"]:.2f}\nTF {t["float"]:.2f}', ha="center", va="center", fontsize=8)
    ax.set_xlim(-.7, 11.7)
    ax.set_ylim(-1.7, 3.7)
    ax.axis("off")
    ax.set_title(f'선후관계 네트워크(AON) | 자원 무제약 CPM {result["cpm_weeks"]:.2f}주', loc="left", fontsize=19, pad=15)
    labels = [f'{t["id"]}: {t["name"]}' for t in tasks]
    fig.text(.025, .08, "\n".join("   |   ".join(labels[i:i+4]) for i in range(0, len(labels), 4)), fontsize=11)
    fig.text(.025, .025, "빨강: 논리적 주공정 / 숫자 단위: 경과 주 / 동시 작업은 추가 인력이 있어야 가능. 1인 실제 일정은 간트 차트 참조.", fontsize=11)
    fig.tight_layout(rect=(0, .23, 1, 1))
    fig.savefig(OUT / "network.png", dpi=150)
    fig.savefig(OUT / "network.svg")
    plt.close(fig)

    # Matplotlib adds trailing spaces to SVG paths; keep generated files Git-clean.
    for svg_path in (OUT / "gantt.svg", OUT / "network.svg"):
        svg = svg_path.read_text(encoding="utf-8")
        svg_path.write_text("\n".join(line.rstrip() for line in svg.splitlines()) + "\n",
                            encoding="utf-8")


def write_outputs(result):
    (OUT / "model_results.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    lines = ["# 계산 결과 — 자동 생성", "", "`python tools/estimate_plan.py`로 재생성한다. 입력 가정과 해석은 [계획 문서](PLAN.md)를 먼저 읽는다.", "",
             "## 규모별 민감도", "", f'| KSLOC | PM | 시간 | 본체 1인·주{INPUT["weekly_hours"]}h 기간 | COCOMO TDEV(월) | 예시 인건비(원) |', "|---:|---:|---:|---:|---:|---:|"]
    for s in result["scenarios"]:
        lines.append(f'| {s["ksloc"]} | {s["pm"]:.3f} | {s["hours"]:,.2f} | {s["solo_weeks"]:.2f}주 | {s["tdev_months"]:.2f} | {s["example_labor_krw"]:,.0f} |')
    lines += ["", "## 작업·CPM·1인 일정", "", "시작은 0, 종료는 다음 작업 시작이 가능한 경과 주다. 표의 기간은 반올림 전 값으로 계산한다.", "",
              "| ID | 작업 | h | 선행 | ES | EF | LS | LF | TF | 1인 시작 | 1인 종료 |", "|---|---|---:|---|---:|---:|---:|---:|---:|---:|---:|"]
    for t in result["tasks"]:
        numbers = " | ".join(f'{t[k]:.2f}' for k in ["es", "ef", "ls", "lf", "float", "resource_start", "resource_finish"])
        lines.append(f'| {t["id"]} | {t["name"]} | {t["hours"]} | {",".join(t["deps"]) or "—"} | {numbers} |')
    lines += [""] + [f'- 논리적 주공정 {i}: {" → ".join(path)}' for i, path in enumerate(result["critical_paths"], 1)]
    lines += [
              f'- 자원 무제약 CPM: {result["cpm_weeks"]:.2f}주',
              f'- 1인 자원 제약 일정: {result["solo_weeks"]:.2f}주 ({math.ceil(result["solo_weeks"])}번째 주 중 종료)',
              f'- 전체 공수: {result["total_hours"]:,}h = COCOMO 본체 올림 {result["main_rounded_hours"]:,}h + 모델 밖 {result["total_hours"] - result["main_rounded_hours"]}h',
              f'- 예시 전체 인건비: {result["total_hours"] * INPUT["hourly_rate_krw"]:,}원 (미확정 단가)',
              "", "## 마일스톤", "", "| 완료 지점 | 의미 | 경과 주 |", "|---|---|---:|"]
    for key, label in [("R", "요구 기준선"), ("C", "구조·클래스 설계"), ("G", "예시 데이터 계획 승인 흐름"), ("K", "기능별 구현·AI 연결"), ("N", "인수 검증"), ("Z", "개인용 설치·운영 안내")]:
        t = next(t for t in result["tasks"] if t["id"] == key)
        lines.append(f'| {key} | {label} | {t["resource_finish"]:.2f} |')
    lines += ["", "## 차트", "", "![자원 무제약 네트워크](network.png)", "", "![1인 간트 차트](gantt.png)", ""]
    (OUT / "CALCULATIONS.md").write_text("\n".join(lines), encoding="utf-8")


if __name__ == "__main__":
    result = calculate(INPUT)
    write_outputs(result)
    charts(result)
    print(json.dumps({k: result[k] for k in ["exponent", "eaf", "main_rounded_hours", "total_hours", "cpm_weeks", "solo_weeks", "critical_paths"]}, ensure_ascii=False, indent=2))
