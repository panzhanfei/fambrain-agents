# Python eval

- PASS G1 闲聊不检索
- PASS G2 姓名（语料 retrieve 或 Mem0 recall）
- PASS G2b 姓名口语变体：我的名字叫什么
- PASS G2c 姓名口语变体：我叫什么
- PASS G3 项目与技术
- PASS G4 城管平台技术
- PASS G5 无上下文 clarify
- PASS G5b 多轮指代补全（QU-02）
- PASS G5c 实体替换续问（入职年份 · 云联智慧 · QU-03）
- PASS K1 姓名（Intake 改写 searchQuery）
- PASS K2 姓名（identityGuard）
- PASS K2b 姓名口语：我的名字叫什么
- PASS K-family-brother 亲友哥哥（default 检索）
- PASS K-family-sil 亲友嫂子（default 检索）
- PASS L3 列举经历（corpus-lister 目录扫盘）
- PASS K4 项目技术
- PASS K5 奥卡云经历
- PASS K-external-link 开源 GitHub（external_link 单槽检索）
- PASS E2E-external-link 单槽开源链接：Sentinel GitHub
- PASS E2E-identity 全链路姓名
- PASS E2E-age 全链路年龄
- PASS E2E-phone 全链路手机（语料 identity）
- PASS E2E-brother 亲友：哥哥姓名
- PASS E2E-sister-in-law 亲友：嫂子姓名
- PASS E2E-family-tri 三连问：本人+哥哥+嫂子姓名
- PASS E2E-enumeration 全链路列举
- PASS E2E-dual-list 纯 list 双槽：项目经历 + 从业经历
- PASS E2E-five-composite 五连问：姓名+年龄+记住QQ side-effect+履历list+开源链接
- PASS E2E-six-composite-qq-phone 六连问：姓名+年龄+QQ(recall)+履历+GitHub+手机（QQ 须先 remember）
- PASS E2E-weather-tianshui 天气：天水（重复地名仍走 get_weather / MCP）
- PASS E2E-weather-go-out 天气+出门建议：禁止 dag（出门建议跟天气走）
- PASS E2E-dag-causal dag.nodes：检索原文 → 翻译 → free 合成对照
- PASS E2E-name-weather-translate 三槽：姓名 + 济南天气 + 翻译eat（禁跨槽复用天气）
- PASS GMem 我的qq是734858469，请帮我记住
- PASS GMem 我的qq是多少
- PASS CACHE-G4-repeat 城管平台用了什么技术
- PASS CACHE-G4-repeat 城管平台用了什么技术
- PASS G-履历综合 我叫什么，我做过什么项目，我在那几家公司上过班，近两年在干什么？
- PASS G-履历综合 我叫什么，我做过什么项目，我在那几家公司上过班，近两年在干什么？
- PASS G-履历综合 我在哪几家公司上过班？
- PASS G-履历综合 1. 我在哪几家公司上过班？
- PASS G-个人档案-亲友 我的名字叫什么
- PASS G-个人档案-亲友 我叫什么 我哥叫什么 我嫂子叫什么
- PASS E2E-five-composite-probe 我的qq是734858469，请帮我记住
- PASS E2E-five-composite-probe 我叫什么？今年多大？列出我的履历。近两年开源项目的GitHub地址是什么？
- PASS E2E-six-composite-qq-phone-probe 我的qq是734858469，请帮我记住
- PASS E2E-six-composite-qq-phone-probe 我叫什么？今年多大？我的QQ号多少？告诉我。告诉我我的简历里面有什么（我的从业经历）。我近两年的开源项目的GitHub地址是什么？我的手机号多少？

ran 47, failed 0

未跑：listPagination / dualListPagination（续页游标）、vaultWorkspace（jobId 暂停恢复）、dagFree（synthesize_merge 夹具）。
