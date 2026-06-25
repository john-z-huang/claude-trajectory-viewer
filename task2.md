# 任务2

## 任务内容

当前的前端项目能够实现结构化的展示 Claude Code请求记录的JSONL文件的内容，本次任务需要处理带有Sub Agent的情况下，批量展示Sub Agent Session的JSONL文件的内容。

## 要求

1. Sub Agent展示的字段内容和规则和原来的Agent一致
2. 提供的是Sub Agent Session的目录，这个目录下是会可能有多个 Sub Agent的Session的，需要在一个新的页面中想办法可以快速的跳转显示多个Sub Agent的Session内容
3. Sub Agent Session可能有调用顺序，要找到目录下记录Sub Agent调用顺序的文件，确定Sub Agent启动的时间，然后按照顺序罗列Sub Agent Session展示的入口，从而可以按照顺序的跳转到指定的Sub Agent Session展示页面

## 案例

`/Users/johannyellow/.claude/projects/-Users-johannyellow-Documents-GitHub-CL4R1T4S-ANTHROPIC/8ab6ca2d-ece3-4e1f-8b10-beba29afd2d8/subagents/workflows/ ` 这个目录是代码中固定的`8ab6ca2d-ece3-4e1f-8b10-beba29afd2d8.jsonl`请求的子代理的会话保存文件地址，其中后缀名为`.meta.json`的文件是相同名称的`.jsonl`文件的元配置信息文件，`journal.jsonl`文件是所有子代理执行完成后，返回给主代理结果的文件。

探索提供的文件夹下面的文件信息，并参考上述提供的内容，完成本次任务。