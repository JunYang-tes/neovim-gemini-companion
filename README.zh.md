![Gemini in Neovim](images/gemini-in-neovim.png)

这个项目用于将gemini-cli/claude-code集成到Neovim中。它通过提供MCP服务来使gemini-cli/claude-code（它们运行在neovim的终端缓冲区中）与Neovim进行交互。这使得：

[x] gemini-cli/claude-code 可以使用neovim作为差异管理器
[x] 将打开的文件作为上下文传递给gemini-cli
[ ] 将诊断信息传递给claude-code


## 入门

1. 安装 [agents-parter.nvim](https://github.com/JunYang-tes/agents-parter.nvim)
2. 使用npm/bun全局安装neovim-ide-companion

```sh
bun i -g neovim-ide-companion
```


## Diff

当gemini需要进行差异比较时，neovim-ide-companion将在您的neovim中使用diff命令打开两个文件。此时，您可以按“a”接受全部，或按“r”拒绝全部。您可以直接编辑gemini生成的内容（通常在右侧，名为new-xxx）。完成对new-xxx的编辑后，在普通模式下按“a”以接受全部。您也可以使用`:w`写入new-xxx，这将自动接受更改。
![Diff](images/diff.png)

>`:help diff` 获取更多信息。


## 开发

0. 编译 typescript
```sh
npx tsc --watch
```

1. 启动Neovim
```sh
cd ./scripts/
./dev-1-start-neovim.sh
```

2. 启动服务器
```
cd ./scripts/
./dev-2-start-server.sh

```

3. 启动gemini/claude


```sh
cd ./scripts/
./dev-3-start-gemini.sh
```

或

```sh
cd ./scripts/
./dev-3-start-claude.sh
```
