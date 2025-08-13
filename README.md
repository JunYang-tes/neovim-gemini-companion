## Getting started 

### Get NVIM_LISTEN_ADDRESS

In your neovim run:
```
:lua print(vim.v.servername)
```

### start neovim-ide-companion
```sh
export NVIM_LISTEN_ADDRESS=/tmp/nvim-ide-companion.sock
neovim-ide-companion --port=40005

```

## start gemini

Environment variables:
- GEMINI_CLI_IDE_WORKSPACE_PATH: path to workspace directory
- GEMINI_CLI_IDE_SERVER_PORT: port number (neovim-ide-companion's server port)
- TERM_PROGRAM: must be set to "vscode" 
```sh
export GEMINI_CLI_IDE_WORKSPACE_PATH=$(pwd)
export GEMINI_CLI_IDE_SERVER_PORT=40005
export TERM_PROGRAM=vscode
gemini
```
