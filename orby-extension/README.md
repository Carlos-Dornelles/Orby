# Orby Compacto

Extensão Manifest V3 para abrir rapidamente as funções básicas do Orby: tarefas, posts, caderno, hábitos e listas.

## Instalar no Google Chrome

1. Deixe esta pasta `orby-extension` no computador.
2. No Chrome, abra `chrome://extensions`.
3. Ative **Modo do desenvolvedor**.
4. Clique em **Carregar sem compactação** e selecione a pasta `orby-extension`.
5. Fixe **Orby Compacto** na barra de extensões e clique no ícone.
6. Entre com sua conta Orby. A extensão tenta `https://orbyapp.discloud.app` e `https://orbyapp.discloud.dev` automaticamente.

O servidor precisa estar ligado e acessível pelo navegador. No primeiro acesso, o Chrome pedirá permissão para conectar aos dois endereços. Se as permissões não estiverem concedidas, a extensão abre as configurações para autorizá-las; com as permissões concedidas, abre o login. A extensão usa o outro endereço se o atual falhar.

## O que está disponível

- **Tarefas:** consultar por dia e filtrar todas, pendentes ou concluídas; adicionar, editar, concluir e excluir. Tarefas novas recebem o horário padrão de 09:00.
- **Posts:** consultar, adicionar, editar e excluir post-its.
- **Caderno:** criar folhas, editar e salvar anotações, trocar de folha e excluir.
- **Hábitos:** criar hábitos simples, marcar ou desmarcar o dia e excluir.
- **Listas:** criar listas simples, adicionar itens, concluir, excluir itens ou a lista.
- **Temas:** Claro, Escuro, Personalizado, Halloween, Natal, Orby Vannila, Frutiger Aero, Wii e Coffe. A escolha fica salva na extensão.
- **Edição:** tarefas, posts, folhas do caderno, hábitos, listas e itens podem ser editados em uma janela modal; a extensão também usa animações suaves, respeitando a preferência por movimento reduzido do sistema.
- **Notificações:** abrir pelo ícone de sino ao lado da engrenagem, ver notificações, marcar como lidas e limpar a lista. Com o navegador aberto e o servidor acessível, a extensão atualiza o contador em segundo plano a cada minuto, sem precisar manter a página do Orby aberta.
- **Hábitos com horários:** criar e editar hábitos simples, com vários horários ou objetivos com data final; marcar cada horário e acompanhar o progresso do dia.

O identificador da conta fica no armazenamento local da extensão. A senha não é salva. Para trocar de conta, use **Sair**.

O site do Orby também oferece o ZIP em **Configurações > Baixar Orby Mini para Chrome**. O Chrome exige confirmação manual: extraia o arquivo, abra `chrome://extensions`, ative **Modo do desenvolvedor** e clique em **Carregar sem compactação**.

Os ícones da extensão usam Bootstrap Icons, como no site. Consulte `LICENSE-bootstrap-icons.txt` para a licença do pacote de ícones.

## Observação de segurança

As rotas de dados existentes no servidor recebem o identificador do usuário pela URL e ainda não validam a sessão autenticada para cada operação. A extensão usa essas mesmas rotas; portanto, este comportamento de segurança do servidor também se aplica a ela. Antes de disponibilizar o servidor publicamente, é importante proteger essas APIs com autenticação e autorização por sessão.
