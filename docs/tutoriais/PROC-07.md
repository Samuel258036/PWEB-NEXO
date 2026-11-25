# PROC-07. Conferir o novo visual do terminal

As telas do Nexo usam uma moldura verde, uma linha de comando com o `>` integrado e uma superfície escura para a leitura.

1. Inicie o Nexo conforme o [README do projeto](../../README.md) e abra a página em uma janela anônima. Veja a pergunta “O que você busca?” e o campo no painel central.
2. Digite o nome de um enigma publicado e pressione Enter. Conclua a identificação para abrir a partida. Se a etapa tiver uma dica, selecione **Pedir dica** para ver o texto junto à margem verde.
3. Reduza a largura da página para 390 px e depois para 320 px. Confira a quebra das linhas e use Tab para percorrer os controles com foco visível.

O [CSS do terminal](../../web/src/index.css) define a composição e as cores. O [componente React](../../web/src/App.jsx) marca o enunciado, as dicas e os controles de navegação. Consulte o [registro da revisão](../registros/PROC-07.md) para ver as verificações.
