# 任务

## 目标

创建一个前端的项目，用来展示Claude Code单个Session的JSONL格式的文件内容。

## 要求

1. 确定Claude Code Session的JSONL文件中各个字段的作用
2. 确定必要的字段，比如 content、response，还有用来确定上下文顺序的字段等等。有些字段时不需要的，比如model，我不在乎当前用的是什么模型
3. Session中有些字段的内容是Markdown格式的内容，判断哪些字段可能会是Markdown格式的内容，渲染的时候使用Markdown解析的方式解析这部分的内容
4. Session中有上下文顺序，找到确定上下文顺序的字段，按照这个字段的顺序展示每一个JSON的内容，确保解析的结果符合Session的时间顺序

## 参考

8ab6ca2d-ece3-4e1f-8b10-beba29afd2d8.jsonl 是一次真实请求的Session文件，参考这个文件的内容完成本次的需求。
