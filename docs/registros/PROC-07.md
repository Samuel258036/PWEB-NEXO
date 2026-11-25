# PROC-07. Aproximar o Nexo das referências visuais

- Origem: pedido de revisão da interface do Nexo.
- Commit-base `1f5a295`. Trailer `Task: PROC-07`.
- [Tutorial](../tutoriais/PROC-07.md)

## Decisão visual

O painel central vem da referência de terminal. O contraste verde sobre preto e os contornos finos vêm das outras duas referências. O painel recebeu uma superfície escura opaca, uma borda verde e um brilho discreto. A grade estática fica no fundo da página. A entrada mantém a pergunta aprovada e o campo de texto.

## Implementação

`web/src/index.css` concentra a moldura, as cores, o foco e a tipografia. O prefixo `>` compartilha a borda do campo. O painel da entrada e da identificação fica mais baixo na tela. O jogo começa mais acima para deixar espaço a enunciados, dicas e ações. Em `web/src/App.jsx`, as classes de leitura, dicas e navegação dão hierarquia ao conteúdo que as telas já exibem.

## Verificações

- O lint, o build, os 52 testes da API e os sete testes da interface passaram no Windows.
- No Chrome, o build conectado ao Express e ao SQLite locais manteve a pergunta e o campo como conteúdo da primeira visita em 320, 390 e 1280 px. O campo manteve foco visível, inclusive com cores forçadas. A tecla Enter abriu a identificação.
- O ensaio com banco descartável percorreu cadastro, abertura de partida, revelação de dica, resposta incorreta, avanço, conclusão, retorno à entrada e tela de autoria. Em 320 px, a partida manteve os controles dentro do painel e quebrou uma palavra longa mesmo com a fonte de teste ampliada a 200%.
- A revisão de design comparou as referências locais e as capturas da entrada em desktop e 390 px e da partida em desktop. Conferiu o painel, o foco e a hierarquia entre enunciado, dica, aviso e ações.
- A revisão didática conferiu os links e o percurso do tutorial. A revisão do código verificou que a moldura, o foco e as regras de quebra de texto ficam no CSS, com as classes ligadas às telas existentes.
