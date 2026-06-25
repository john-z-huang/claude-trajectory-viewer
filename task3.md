# 任务3

## 任务内容

解析workflow的json格式的记录文件，用来渲染展示这次workflow的内容

## 要求

1. 目前一个任务Session只有一个workflow，因此workflow解析的页面不用做成列表展示
2. workflow内容解析内容的逻辑和 Agent、Sub Agent的解析逻辑一致，需要判断哪些字段是需要的，哪些字段是不需要的，同时有些字段的内容返回的是代码或者Markdown，需要使用对应的方式进行解析，确保能够按照要求进行渲染