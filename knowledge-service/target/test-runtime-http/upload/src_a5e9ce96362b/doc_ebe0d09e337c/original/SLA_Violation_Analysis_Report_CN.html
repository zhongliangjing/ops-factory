<!DOCTYPE html>
<html lang="cn">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SLA违约归因分析报告</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif; background: #f3f4f6; color: #374151; line-height: 1.6; }
        .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #1e40af, #3b82f6); color: white; padding: 30px; border-radius: 12px; margin-bottom: 24px; }
        .header h1 { font-size: 28px; margin-bottom: 8px; }
        .header .date { opacity: 0.9; }
        .card { background: white; border-radius: 12px; padding: 24px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
        .card h2 { font-size: 20px; color: #1e40af; margin-bottom: 16px; padding-bottom: 8px; border-bottom: 2px solid #e5e7eb; }
        .card h3 { font-size: 16px; color: #374151; margin: 20px 0 12px; }
        .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin-bottom: 20px; }
        .metric { background: #f9fafb; padding: 16px; border-radius: 8px; text-align: center; }
        .metric .value { font-size: 28px; font-weight: bold; color: #1e40af; }
        .metric .label { color: #6b7280; font-size: 13px; margin-top: 4px; }
        .metric.danger .value { color: #ef4444; }
        .metric.success .value { color: #10b981; }
        table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 14px; }
        th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid #e5e7eb; }
        th { background: #f9fafb; font-weight: 600; color: #374151; }
        tr:hover { background: #f9fafb; }
        .badge { display: inline-block; padding: 4px 10px; border-radius: 20px; font-size: 11px; font-weight: 500; }
        .badge.high, .badge.critical { background: #fee2e2; color: #991b1b; }
        .badge.medium, .badge.severe { background: #fef3c7; color: #92400e; }
        .badge.low, .badge.minor { background: #d1fae5; color: #065f46; }
        .badge.process { background: #dbeafe; color: #1e40af; }
        .badge.resource { background: #ede9fe; color: #6b21a8; }
        .badge.external { background: #fef3c7; color: #92400e; }
        .badge.timewindow { background: #fee2e2; color: #991b1b; }
        .chart-container { text-align: center; margin: 20px 0; }
        .chart-container img { max-width: 100%; height: auto; border-radius: 8px; }
        .recommendation { padding: 16px; border-left: 4px solid #3b82f6; background: #f9fafb; margin: 12px 0; border-radius: 0 8px 8px 0; }
        .recommendation.critical { border-left-color: #ef4444; background: #fef2f2; }
        .recommendation.high { border-left-color: #f59e0b; background: #fffbeb; }
        .recommendation strong { color: #374151; }
        .recommendation ul { margin: 8px 0 0 20px; }
        .recommendation li { margin: 4px 0; }
        .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
        @media (max-width: 768px) { .grid-2 { grid-template-columns: 1fr; } }
        .footnote { font-size: 12px; color: #6b7280; margin-top: 12px; padding-top: 12px; border-top: 1px dashed #e5e7eb; }
        .alert { padding: 12px 16px; border-radius: 8px; margin: 16px 0; }
        .alert.danger { background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; }
        .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 14px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>SLA违约归因分析报告</h1>
            <div class="date">数据周期: 2024-04-19 ~ 2025-07-06</div>
        </div>

        <div class="card">
            <h2>执行摘要</h2>
            <div class="metrics">
                <div class="metric"><div class="value">8,977</div><div class="label">总工单数</div></div>
                <div class="metric success"><div class="value">99.9%</div><div class="label">响应SLA</div></div>
                <div class="metric danger"><div class="value">64.2%</div><div class="label">解决SLA</div></div>
                <div class="metric danger"><div class="value">3,214</div><div class="label">违约总数</div></div>
                <div class="metric danger"><div class="value">4,423</div><div class="label">高风险工单</div></div>
            </div>
            <div class="alert danger"><strong>严重告警:</strong> 解决SLA (64.2%) 显著低于95%目标。P1解决SLA仅6.9%，P2为15.5%。需立即采取行动。</div>
        </div>

        <div class="card">
            <h2>高优先级分析 (P1/P2)</h2>
            <p style="color: #6b7280; margin-bottom: 16px;">P1和P2事件需要立即关注。SLA目标：P1响应15分钟/解决2小时，P2响应30分钟/解决6小时。</p>
            <div class="grid-2">
                <div>
                    <h3>P1表现 (Total: 448)</h3>
                    <div class="metrics">
                        <div class="metric success"><div class="value">98.9%</div><div class="label">响应SLA</div></div>
                        <div class="metric danger"><div class="value">6.9%</div><div class="label">解决SLA</div></div>
                    </div>
                </div>
                <div>
                    <h3>P2表现 (Total: 1346)</h3>
                    <div class="metrics">
                        <div class="metric success"><div class="value">99.7%</div><div class="label">响应SLA</div></div>
                        <div class="metric danger"><div class="value">15.5%</div><div class="label">解决SLA</div></div>
                    </div>
                </div>
            </div>
            <div class="chart-container"><img src="images/p1_p2_analysis_CN.png" alt="P1/P2 Analysis"></div>
        </div>

        <div class="card">
            <h2>月度趋势分析</h2>
            <div class="chart-container"><img src="images/monthly_trend_CN.png" alt="Monthly Trend"></div>
        </div>

        <div class="card">
            <h2>按优先级SLA达成率</h2>
            <div class="chart-container"><img src="images/sla_by_priority_CN.png" alt="SLA by Priority"></div>
            <table>
                <thead><tr><th>优先级</th><th>响应目标</th><th>响应SLA</th><th>解决目标</th><th>解决SLA</th><th>总计</th></tr></thead>
                <tbody><tr><td><strong>P1</strong></td><td>15 min</td><td><span class="badge low">98.9%</span></td><td>2 h</td><td><span class="badge high">6.9%</span></td><td>448</td></tr><tr><td><strong>P2</strong></td><td>30 min</td><td><span class="badge low">99.7%</span></td><td>6 h</td><td><span class="badge high">15.5%</span></td><td>1,346</td></tr><tr><td><strong>P3</strong></td><td>45 min</td><td><span class="badge low">99.9%</span></td><td>24 h</td><td><span class="badge high">47.6%</span></td><td>3,141</td></tr><tr><td><strong>P4</strong></td><td>60 min</td><td><span class="badge low">100.0%</span></td><td>48 h</td><td><span class="badge low">99.7%</span></td><td>4,042</td></tr></tbody></table></div>

        <div class="card">
            <h2>风险分析</h2>
            <div class="chart-container"><img src="images/risk_distribution_CN.png" alt="Risk Distribution"></div>
            <h3>高风险工单 (Top 10)</h3>
            <p style="color: #6b7280; font-size: 13px; margin-bottom: 12px;">接近或超过SLA阈值的工单。"超出"显示超过SLA目标的小时数。</p>
            <table>
                <thead><tr><th>工单号</th><th>优先级</th><th>类别</th><th>处理人</th><th>实际</th><th>目标</th><th>超出</th><th>归因</th></tr></thead>
                <tbody><tr><td>80000001</td><td>P4</td><td>Digital View Monitoring</td><td>Susan Smith</td><td>40.3h</td><td>48h</td><td><span class="badge low">0.0h</span></td><td><span class="badge timewindow">TimeWindow</span></td></tr><tr><td>80000005</td><td>P3</td><td>Digital View Monitoring</td><td>Jessica Smith</td><td>19.9h</td><td>24h</td><td><span class="badge low">0.0h</span></td><td><span class="badge resource">Resource</span></td></tr><tr><td>80000022</td><td>P3</td><td>Digital View Monitoring</td><td>Jennifer Smith</td><td>23.3h</td><td>24h</td><td><span class="badge low">0.0h</span></td><td><span class="badge resource">Resource</span></td></tr><tr><td>80000034</td><td>P4</td><td>Digital View Monitoring</td><td>Jessica Smith</td><td>44.2h</td><td>48h</td><td><span class="badge low">0.0h</span></td><td><span class="badge timewindow">TimeWindow</span></td></tr><tr><td>80000049</td><td>P3</td><td>Cardless Cash Out</td><td>Sarah Smith</td><td>21.1h</td><td>24h</td><td><span class="badge low">0.0h</span></td><td><span class="badge timewindow">TimeWindow</span></td></tr><tr><td>80000056</td><td>P3</td><td>Other</td><td>Lisa Smith</td><td>22.2h</td><td>24h</td><td><span class="badge low">0.0h</span></td><td><span class="badge resource">Resource</span></td></tr><tr><td>80000060</td><td>P3</td><td>Digital View Monitoring</td><td>Karen Smith</td><td>22.1h</td><td>24h</td><td><span class="badge low">0.0h</span></td><td><span class="badge resource">Resource</span></td></tr><tr><td>80000062</td><td>P4</td><td>Onboarding</td><td>Daniel Smith</td><td>43.8h</td><td>48h</td><td><span class="badge low">0.0h</span></td><td><span class="badge process">Process</span></td></tr><tr><td>80000073</td><td>P4</td><td>Bill Payment</td><td>Robert Smith</td><td>45.0h</td><td>48h</td><td><span class="badge low">0.0h</span></td><td><span class="badge timewindow">TimeWindow</span></td></tr><tr><td>80000076</td><td>P3</td><td>Digital View Monitoring</td><td>David Smith</td><td>22.6h</td><td>24h</td><td><span class="badge low">0.0h</span></td><td><span class="badge resource">Resource</span></td></tr></tbody></table></div>

        <div class="card">
            <h2>违约深度分析</h2>
            <div class="chart-container"><img src="images/severity_distribution_CN.png" alt="Severity"></div>
            <h3>按严重程度排序的违约 (Total: 3,214)</h3>
            <table>
                <thead><tr><th>工单号</th><th>优先级</th><th>类别</th><th>处理人</th><th>解决时长</th><th>超出</th><th>归因</th></tr></thead>
                <tbody><tr><td>80007418</td><td>P2</td><td>Infra</td><td>Thomas Smith</td><td>9570.2h</td><td><span class="badge critical">+9564.2h</span></td><td><span class="badge resource">Resource</span></td></tr><tr><td>80002938</td><td>P1</td><td>Customer Complaint</td><td>David Smith</td><td>9459.2h</td><td><span class="badge critical">+9457.2h</span></td><td><span class="badge resource">Resource</span></td></tr><tr><td>80000956</td><td>P4</td><td>Other</td><td>Daniel Smith</td><td>9064.2h</td><td><span class="badge critical">+9016.2h</span></td><td><span class="badge timewindow">TimeWindow</span></td></tr><tr><td>80005518</td><td>P4</td><td>Compliance</td><td>Mary Smith</td><td>8438.3h</td><td><span class="badge critical">+8390.3h</span></td><td><span class="badge timewindow">TimeWindow</span></td></tr><tr><td>80006606</td><td>P2</td><td>Cash In</td><td>Thomas Smith</td><td>1605.5h</td><td><span class="badge critical">+1599.5h</span></td><td><span class="badge resource">Resource</span></td></tr><tr><td>80000772</td><td>P3</td><td>International Money Transfer</td><td>Linda Smith</td><td>1075.7h</td><td><span class="badge critical">+1051.7h</span></td><td><span class="badge resource">Resource</span></td></tr><tr><td>80007087</td><td>P3</td><td>Onboarding</td><td>Robert Smith</td><td>849.7h</td><td><span class="badge critical">+825.7h</span></td><td><span class="badge resource">Resource</span></td></tr><tr><td>80008807</td><td>P2</td><td>Compliance</td><td>Christopher Smith</td><td>746.8h</td><td><span class="badge critical">+740.8h</span></td><td><span class="badge resource">Resource</span></td></tr><tr><td>80002599</td><td>P1</td><td>Card</td><td>William Smith</td><td>620.9h</td><td><span class="badge critical">+618.9h</span></td><td><span class="badge process">Process</span></td></tr><tr><td>80001614</td><td>P3</td><td>Card</td><td>Jessica Smith</td><td>621.0h</td><td><span class="badge critical">+597.0h</span></td><td><span class="badge timewindow">TimeWindow</span></td></tr><tr><td>80004092</td><td>P4</td><td>Digital View Monitoring</td><td>Lisa Smith</td><td>533.0h</td><td><span class="badge critical">+485.0h</span></td><td><span class="badge process">Process</span></td></tr><tr><td>80000649</td><td>P3</td><td>Digital View Monitoring</td><td>Daniel Smith</td><td>491.5h</td><td><span class="badge critical">+467.5h</span></td><td><span class="badge timewindow">TimeWindow</span></td></tr><tr><td>80005948</td><td>P4</td><td>Cash Out</td><td>Patricia Smith</td><td>501.4h</td><td><span class="badge critical">+453.4h</span></td><td><span class="badge resource">Resource</span></td></tr><tr><td>80003571</td><td>P2</td><td>Card</td><td>Lisa Smith</td><td>455.1h</td><td><span class="badge critical">+449.1h</span></td><td><span class="badge process">Process</span></td></tr><tr><td>80002489</td><td>P4</td><td>Account Management</td><td>Daniel Smith</td><td>462.9h</td><td><span class="badge critical">+414.9h</span></td><td><span class="badge process">Process</span></td></tr></tbody></table></div>

        <div class="card">
            <h2>归因分析</h2>
            <div class="chart-container"><img src="images/attribution_CN.png" alt="Attribution"></div>
            <div class="metrics"><div class="metric"><div class="value" style="color: #3b82f6;">1,024</div><div class="label">流程 (23%)</div></div><div class="metric"><div class="value" style="color: #8b5cf6;">692</div><div class="label">资源 (15%)</div></div><div class="metric"><div class="value" style="color: #f59e0b;">842</div><div class="label">外部 (19%)</div></div><div class="metric"><div class="value" style="color: #ef4444;">1,986</div><div class="label">时间窗 (44%)</div></div></div>
            <div class="footnote">注：归因总数 (4,544) 可能与违约数 (3,214) 不同，因为单个工单可能有多个归因因素。</div>
        </div>

        <div class="card">
            <h2>按类别违约分布</h2>
            <div class="chart-container"><img src="images/violations_by_category_CN.png" alt="Category"></div>
        </div>

        <div class="card">
            <h2>改进建议</h2><div class="recommendation critical"><strong>[紧急] P1/P2 SLA表现</strong><p>P1解决SLA为6.9%（目标：95%）。P2为15.5%。</p><ul><li>建立专门的P1/P2响应团队，确保<15分钟初始响应</li><li>实施50% SLA消耗后自动升级机制</li><li>创建P1战时协议，实现多团队协调</li><li>审查P1/P2分类标准，确保正确优先级排序</li></ul></div><div class="recommendation critical"><strong>[紧急] 时间窗口因素 (占违约44%)</strong><p>大多数违约发生在非工作时间（18:00-09:00）和周末。</p><ul><li>加强18:00-09:00班次的值班覆盖</li><li>实施周末轮值制度，配备专门升级路径</li><li>考虑非工作时间工单的自动分诊和路由</li><li>评估P1/P2事件的24/7 NOC覆盖</li></ul></div><div class="recommendation high"><strong>[高] 外部依赖 (占违约19%)</strong><p>等待外部团队或客户导致显著延迟。</p><ul><li>与依赖团队建立SLA协议（内部OLA）</li><li>实施自动客户跟进提醒</li><li>创建"等待外部"仪表板，主动管理</li><li>定义外部等待超过阈值时的升级触发器</li></ul></div><div class="recommendation high"><strong>[高] 流程改进 (占违约23%)</strong><p>转派和升级延迟导致SLA违约。</p><ul><li>减少平均转派次数（目标：<2次/工单）</li><li>实施基于技能的路由，减少转派</li><li>创建清晰的升级矩阵，定义触发条件</li><li>培训L1团队更好地进行初始分类</li></ul></div><div class="recommendation recommendation"><strong>[中] 类别聚焦：Digital View Monitoring</strong><p>该类别占1,480个违约（总数的46%）。</p><ul><li>审查监控告警阈值，减少误报</li><li>为常见场景创建操作手册</li><li>考虑自动化重复性任务</li></ul></div><div class="recommendation recommendation"><strong>[中] 处理人工作负荷</strong><p>排名第一的处理人有154个违约。考虑工作负荷均衡。</p><ul><li>审查团队成员间的工作负荷分配</li><li>实施工作负荷上限和自动重分配</li><li>识别表现较差处理人的培训需求</li></ul></div></div>

        <div class="footer">生成时间 2026-01-28 23:05 | SLA违约归因分析报告</div>
    </div>
</body>
</html>