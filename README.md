# Orby

Aplicativo de tarefas com servidor Express e banco MongoDB.

## Requisitos

- Node.js 20 ou superior
- Uma instância MongoDB local ou MongoDB Atlas

## Configurar o banco

1. Crie um cluster no [MongoDB Atlas](https://www.mongodb.com/atlas/database) ou escolha uma instância MongoDB local.
2. No Atlas, crie um usuário de banco de dados e permita o endereço IP da máquina em **Network Access**. Evite liberar acesso irrestrito em produção.
3. Copie a URI de conexão do cluster. Use o nome do banco `ORBYDB` e substitua `<usuario>`, `<senha>` e `<cluster>` pelos valores do seu Atlas. Se a senha tiver caracteres especiais, faça URL-encode nela.
4. Crie o arquivo `.env` na raiz do projeto, se necessário, e informe nele a URI em `MONGODB_URI`. Mantenha o `.env` apenas na sua máquina e não compartilhe sua URI/senha.
5. Para conexões `mongodb+srv`, o servidor consulta por padrão os DNS públicos `1.1.1.1` (Cloudflare) e `8.8.8.8` (Google) para localizar os servidores do Atlas. Se sua rede bloquear DNS externo, configure `MONGODB_DNS_SERVERS` com os resolvedores permitidos pela rede ou libere DNS de saída na porta 53.
6. O cartão de clima usa a Open-Meteo sem chave. Se a geolocalização for negada ou indisponível, o app consulta Porto Alegre como cidade padrão.
7. Para adicionar imagens como widgets, informe `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY` e `CLOUDINARY_API_SECRET` no `.env`. O segredo permanece no servidor; cada imagem é enviada diretamente à Cloudinary com assinatura temporária.
8. Para habilitar a Orb.IA, gere uma chave mestra com `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"` e adicione o resultado ao `.env` como `ORBY_AI_MASTER_KEY`. Use uma chave aleatória de 32 bytes, mantenha-a fora do repositório e faça backup seguro: sem ela, não será possível descriptografar as chaves Gemini guardadas no banco. A mesma chave assina as sessões exclusivas da Orb.IA; após configurá-la ou alterá-la, entre novamente no Orby. Em produção, sirva o Orby por HTTPS.

O banco e a coleção `USERS` são criados pelo MongoDB na primeira gravação. Crie sua conta pela opção **Criar conta** na tela de login. As senhas novas são armazenadas como hashes bcrypt (custo 12), não como texto simples, e o cadastro aceita até 72 bytes por senha. Contas antigas que ainda tenham a senha em texto simples são migradas automaticamente para bcrypt após um login válido.

## Notificações push no Android (Firebase Cloud Messaging)

1. No [Firebase Console](https://console.firebase.google.com/), crie ou escolha um projeto e adicione um app Android com o ID de pacote exato `app.orby.mobile`.
2. Baixe o `google-services.json` desse app e coloque-o em `mobile-android/app/google-services.json`. Não use o arquivo de outro app/pacote: o projeto Firebase do Android precisa ser o mesmo da conta de serviço do servidor.
3. Em **Configurações do projeto > Contas de serviço**, gere uma chave privada JSON para uma conta de serviço. Cadastre o conteúdo integral do arquivo em `FIREBASE_SERVICE_ACCOUNT_JSON` nas variáveis de ambiente do servidor de produção. Essa chave é privada: nunca a coloque no repositório, no APK ou em mensagens.
4. Execute `npm.cmd install` e `npx.cmd cap sync android`, gere um APK novo e reinstale-o no celular. O app pede permissão em **Configurações > Ativar notificações** e registra cada aparelho na conta conectada. Tokens são removidos do usuário ao sair da conta.
5. Mantenha o servidor rodando com acesso ao Firebase. O FCM envia tarefas, hábitos e eventos de xadrez mesmo quando o app está fechado; alarmes locais continuam como alternativa quando o FCM ainda não está configurado. O status de notificações informa quando falta configurar credencial no servidor. O Firebase Cloud Messaging não cobra pelo envio de push.

As chaves têm funções diferentes: `google-services.json` identifica o app Android no Firebase e vai apenas no diretório local do projeto Android; `FIREBASE_SERVICE_ACCOUNT_JSON` autoriza o servidor a enviar notificações e deve existir somente como segredo no ambiente de produção.

Para alterar a senha, abra **Configurações do perfil**, clique em **Redefinir senha** e informe a senha atual e a nova senha. A nova senha deve ter pelo menos seis caracteres e no máximo 72 bytes.

Ao criar ou editar tarefas, defina a data, a hora (00 a 23), os minutos em intervalos de cinco e a cor da faixa. Escolha entre vermelho, azul, amarelo e verde, ou use o seletor para escolher outra cor. Use a alça para arrastar e salvar a prioridade, ou arraste a tarefa até um dia do calendário para alterar sua data. Durante o arraste, uma prévia acompanha o ponteiro. Clique na lupa para pesquisar no dia/período selecionado.

Na tela de tarefas, ative **Arrastar widgets** em Configurações para mover calendário, tempo, imagens e o novo widget de lista pela alça; também é possível usar as setas do teclado. Em **Configurações > Gerenciar widgets**, escolha uma lista já criada, e marque ou desmarque seus itens direto no widget. A lista exibida e as posições ficam salvas no MongoDB por usuário e acompanham a conta em outros computadores.

Em **Configurações > Gerenciar widgets**, ative ou oculte o calendário, o tempo e cada imagem, ou adicione várias imagens de até 10 MB. Com **Arrastar widgets** ativo, use o lápis para substituir a imagem do widget sem mudar sua posição. Layout, visibilidade, post-its do painel, relógio, hábito selecionado, modo de arraste e tamanho do painel ficam no MongoDB por usuário.

O widget **Links** pode ser ativado em **Configurações > Gerenciar widgets**. Clique no ícone para abrir o painel ao lado, adicione links HTTP ou HTTPS com um nome e abra-os em uma nova aba; links salvos ficam associados à conta e podem ser removidos pelo próprio painel. O limite é de 50 links por usuário.

O widget **Xadrez** pode ser ativado em **Configurações > Gerenciar widgets**. Jogue localmente com as brancas e as pretas na mesma tela, contra o Stockfish (com escolha de cor e nível) ou convide outro usuário Orby pelo e-mail. Cada jogada confirmada toca o som de xadrez; capturas usam o som específico de peça capturada, inclusive em partidas por convite. O convidado recebe uma notificação verde no sino e pode aceitar ou recusar; ao aceitar, a partida começa e os lances legais são sincronizados pelo servidor. As peças capturadas aparecem em fileiras visuais acima e abaixo do tabuleiro, identificadas pelo lado que capturou. Em **Configurações do xadrez**, ative ou desative o aviso verde no sino quando o oponente fizer um lance e escolha entre os temas de tabuleiro verde e branco, preto e branco ou madeira. As preferências são salvas na conta; os lances também têm uma animação suave, respeitando a opção de movimento reduzido do dispositivo. Convites pendentes expiram em sete dias. A engrenagem abre as opções, o histórico de lances e o histórico cronológico de partidas, com adversário, cor, quantidade de lances e resultado. Arraste a alça no canto inferior direito para ajustar o tamanho do tabuleiro. Partidas locais e contra Stockfish são salvas na conta e retomadas em outros dispositivos; os resultados locais finalizados também são registrados no histórico, junto às partidas por convite salvas no MongoDB. O tabuleiro online sincroniza automaticamente enquanto aguarda o adversário e ao retornar à janela. Posição e largura do widget ficam nas preferências da conta. O motor Stockfish.js é distribuído sob GPL-3.0; sua licença está em `node_modules/stockfish.js/Copying.txt`.

O widget **Orb.IA** pode ser ativado em **Configurações > Gerenciar widgets**; sua posição e tamanho podem ser ajustados pela alça em L no canto inferior direito e ficam salvos no layout. Em **Configurações** no próprio widget, abra o painel flutuante para salvar uma chave API do Gemini, criada no [Google AI Studio](https://aistudio.google.com/app/apikey). A chave é criptografada com AES-256-GCM antes de ser salva no MongoDB; a chave mestra `ORBY_AI_MASTER_KEY` fica somente no ambiente do servidor e também protege uma sessão assinada exclusiva da IA. A conversa usa a Interactions API e alterna automaticamente entre Gemini 3.8 Flash, Gemini 3.5 Flash-Lite e Gemini 2.5 Flash-Lite se houver limite de cota ou indisponibilidade temporária. A lista de modelos é restrita a modelos com faixa gratuita; a Orb.IA não habilita faturamento nem troca para modelos fora dela. O Google aplica limites por projeto que variam por modelo e podem mudar; se todos os modelos gratuitos atingirem o limite, será necessário aguardar. O código não consegue desligar o faturamento do projeto: para garantir que o Google não cobre, não habilite faturamento no projeto associado à chave. A Orb.IA pode receber o nome do usuário, até 100 tarefas, hábitos, post-its, folhas do caderno e listas. Quando o widget de clima está ativo, também pode consultar as condições atuais e a previsão de sete dias da API Open-Meteo. As solicitações são configuradas como não armazenadas no Google (`store: false`); o histórico enviado para cada resposta permanece em memória no cliente. A IA não altera dados do Orby. As instruções de comportamento ficam em `ensinoRobo.js`. Erros de chave, acesso, cota ou disponibilidade são mostrados no widget para ajudar no diagnóstico. Cada usuário pode trocar ou remover sua própria chave no widget.

Em **Posts**, crie post-its com título, descrição e cor. Edite ou exclua pelos botões do cartão; arraste pelo cabeçalho para organizar e pelo canto inferior direito para redimensionar. Conteúdo, posição e tamanho ficam salvos no usuário no MongoDB.

Em **Caderno**, crie folhas, escreva um título e suas anotações, e use as setas para navegar entre elas. A folha ocupa o espaço disponível e permite escolher pauta com linhas, quadriculada, pontilhada ou sem pauta, além da cor e do espaçamento. Salve as alterações antes de sair da folha; texto e estilo ficam guardados no MongoDB e podem ser excluídos individualmente.

Em **Hábitos**, crie hábitos diários, escolha o horário do lembrete e marque cada um como feito. O app mostra a sequência atual e a melhor sequência; dias não marcados encerram a sequência na virada do dia. Hábitos e histórico ficam salvos na conta do MongoDB.

No cartão de clima, clique na condição atual para expandir as métricas atuais e a previsão para os próximos sete dias.

Quando o Orby estiver aberto, tarefas pendentes e hábitos geram uma notificação no sino ao chegar o horário. O histórico fica guardado por sete dias. No APK Android, abra **Configurações > Ativar notificações** e permita notificações. Com o FCM configurado, tarefas, hábitos e eventos de xadrez chegam mesmo com o app fechado; sem ele, alarmes locais exatos e sincronização em segundo plano continuam como alternativa. **Alarmes e lembretes** do Android são necessários para os alarmes locais, mas não para o push do Firebase. No navegador, permita notificações em **Configurações > Ativar notificações**; o navegador precisa estar aberto para os avisos do site.

## Executar

```bash
npm.cmd install
npm.cmd run start-server
```

Abra `http://localhost:8080/login.html`. O servidor usa nodemon para reiniciar automaticamente.

## Limites conhecidos

- O Caderno salva uma folha por vez ao usar o botão **Salvar folha**.
- O login mantém um identificador acessível pelo navegador. As APIs existentes de tarefas e outros recursos ainda não validam uma sessão autenticada; o bcrypt protege as senhas armazenadas, mas não substitui a autorização dessas APIs. A Orb.IA usa uma sessão assinada e protegida por cookie HttpOnly apenas nas rotas da IA; isso não altera a autorização das demais APIs.
- A URI do banco e as credenciais não devem ser enviadas ao repositório nem compartilhadas em mensagens.
