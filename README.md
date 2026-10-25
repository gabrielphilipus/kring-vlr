# Kring VLR — aplicativo pessoal de análise de Valorant

Aplicativo desktop para Windows feito com Electron + React. A interface e as instruções estão em português.

## O que já está incluído

- **VODs:** título, link, data, mapa, agente jogado, abates, mortes, assistências, resultado e notas de análise.
- **Lineups:** mapa, agente, habilidade, lado (ataque/defesa/ambos), instruções, link e screenshot opcional. Você pode escolher um arquivo ou copiar um print (por exemplo, com `Win + Shift + S`), clicar na área de colagem e pressionar `Ctrl + V`.
- **Dashboard:** partidas registradas, winrate, abates, lineups, winrate por mapa e partidas recentes.
- **Estatísticas:** winrate por mapa, por agente e pela combinação mapa + agente, média de K/D individual por VOD e totais de abates, mortes e assistências, com filtros.
- **Dados locais:** salvamento automático no perfil do aplicativo do Windows, sem exigir conta ou serviço externo.
- **Backup:** exportar/importar arquivo JSON para guardar ou mover seus dados.
- **Instalador:** configuração para gerar instalador Windows (.exe) e versão portátil.

O winrate usa `vitórias ÷ (vitórias + derrotas)`. Empates não entram no denominador. O total de partidas exibido inclui empates.

## Pré-requisitos — configurar apenas uma vez

1. Instale o **Node.js LTS** no site oficial: https://nodejs.org/ . Use uma versão LTS recente, preferencialmente Node 22.12 ou superior.
2. Instale o **Visual Studio Code**: https://code.visualstudio.com/ .
3. Extraia o arquivo ZIP deste projeto para uma pasta fácil de encontrar, por exemplo `Documentos\Kring-VLR`.
4. Abra o VS Code, vá em **File / Arquivo → Open Folder / Abrir Pasta** e selecione a pasta `kring-vlr-app` extraída.
5. No VS Code, abra **Terminal → New Terminal / Novo Terminal**.

## Rodar o aplicativo durante o desenvolvimento

Copie e cole este comando no terminal do VS Code e pressione Enter:

```powershell
npm.cmd install
```

Esse comando baixa as dependências. Precisa de internet e pode levar alguns minutos na primeira execução.

Quando terminar, rode:

```powershell
npm.cmd run dev
```

Uma janela do **Kring VLR** deve abrir. Deixe o terminal aberto enquanto estiver usando essa versão de desenvolvimento. Para encerrar, feche o aplicativo e pressione `Ctrl + C` no terminal.

## Gerar o instalador para Windows

No terminal do VS Code, feche a aplicação de desenvolvimento (`Ctrl + C`) e execute:

```powershell
npm.cmd run dist:win
```

Ao terminar, procure a pasta `release` dentro do projeto. Ela deve conter o instalador `Kring VLR Setup ... .exe` e uma versão portátil `.exe`. Dê dois cliques no instalador para instalar o programa como um aplicativo normal do Windows.

Se quiser gerar somente a versão portátil, execute:

```powershell
npm.cmd run dist:portable
```

A primeira geração do instalador pode baixar componentes adicionais e exige internet.

## Onde os dados ficam salvos?

Na versão instalada, os registros são salvos automaticamente na pasta de dados do aplicativo dentro do perfil do Windows. Desinstalar e reinstalar aplicativos normalmente preserva essa pasta, mas **use Backup regularmente** e guarde o arquivo exportado em outro lugar. Não dependa da pasta local como única cópia das suas anotações.

Os screenshots das lineups são comprimidos antes de serem salvos. Ainda assim, é recomendável exportar backups depois de adicionar muitas imagens.

## Importante

- Este projeto é local: os dados não são sincronizados entre computadores e não há login ou nuvem nesta versão.
- Os links de VOD abrem no navegador padrão; o aplicativo não baixa nem analisa automaticamente o conteúdo do YouTube.
- Mapas e agentes sugeridos nos campos são apenas atalhos. Você pode digitar outro nome caso o jogo mude.
- Antes de substituir ou importar uma cópia de segurança, mantenha um backup recente dos seus dados.

## Estrutura do projeto

- `src/App.jsx` — telas, formulários, estatísticas e interação.
- `src/styles.css` — aparência visual.
- `electron/main.cjs` — janela do aplicativo e salvamento dos dados.
- `electron/preload.cjs` — ponte segura entre a interface e o aplicativo desktop.
- `package.json` — dependências e comandos para rodar/empacotar.
