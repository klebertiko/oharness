# ADR 0070 — Cofre em arquivo: permissão do usuário e chave por instalação

Status: aceita. Fecha o achado de SEC do PR #446 que já existia em `main` (issue #452). Não muda o diretório de dados (#409 / #446).

## Contexto

`OH_SECRETS=file` gravava o cofre com o modo padrão do processo (na prática 0644) e derivava a chave Fernet só do caminho absoluto. Quem lê o arquivo e conhece o caminho lê o segredo. No Windows a pasta herdava a ACL do pai.

## Decisão

- A pasta do cofre nasce `0700` e cada arquivo `0600`. No Windows a ACL é a de `restrict_to_current_user`. No POSIX a pasta não passa por essa função: hoje ela aplica `0600`, o que tira o bit de travessia de um diretório. A restrição acontece antes de qualquer byte de segredo: o arquivo é criado vazio já em `0600`, a ACL ou o modo é aplicado, e só então o conteúdo é escrito. Se a restrição falha, o arquivo vazio é apagado e nada é gravado.
- A chave deixa de ser o caminho. Cada instalação tem um segredo aleatório. Se o pacote opcional `keyring` tem um backend utilizável, o segredo fica no chaveiro (serviço `oharness.file-store`). Sem chaveiro, fica no arquivo `.install-key`, só do usuário, dentro da pasta do cofre.
- **Limitação, sem chaveiro:** qualquer processo do mesmo usuário lê a chave e o ciphertext. O modo `0600` (e a ACL) barra outros usuários, não outros processos deste usuário. Não substitui `OH_SECRETS=keychain`, que guarda as próprias credenciais no chaveiro.
- Arquivos antigos, cifrados com a derivação do caminho (`openharness.file-secrets.v1`), são relidos com essa chave e regravados com a chave nova na primeira abertura, no mesmo lugar. Um arquivo que nenhuma das duas chaves abre permanece no disco. A pasta pré-rebrand continua sendo aberta onde está, porque a chave antiga depende do caminho até essa migração.
- **Windows: a DACL é protegida e só tem o usuário, de propósito.** Uma única chamada troca a DACL inteira por um ACE do usuário atual (`D:P(A;;FA;;;<SID>)`, com herança na pasta). Isso remove `SYSTEM` e `Administradores`, que um cofre comum herdaria. É intencional: o objetivo é barrar também outras contas locais. O custo: um backup que roda como `SYSTEM` (ou antivírus e indexador que varrem como `SYSTEM`) não lê nem copia estes arquivos, e restaurar o cofre exige reaplicar a ACL ou abrir uma vez com o app. Um administrador local ainda pode assumir a propriedade do arquivo; isto não o impede.
- **Windows: a ACL vai no handle aberto.** O arquivo é criado com `CREATE_NEW` (equivalente ao `O_EXCL`) e acesso `WRITE_DAC`, e a DACL é aplicada nesse handle (`SetSecurityInfo`) antes de qualquer byte de segredo. Nenhum nome é resolvido de novo, então uma junção trocada entre a checagem e a ACL não redireciona nada. A pasta do cofre continua por nome, depois da recusa de link.
- **Windows: leitura e troca concorrentes.** Os leitores abrem com `FILE_SHARE_READ|WRITE|DELETE`. A troca do arquivo usa rename com semântica POSIX (`FILE_RENAME_FLAG_POSIX_SEMANTICS`, Windows 10 1809+), que vale mesmo com um leitor aberto. Se o sistema recusa, cai em `os.replace` com poucas tentativas limitadas para `WinError 5` e `32`, e depois falha fechado.
- A via de assinatura (`credential.kind=cli`) não lê o cofre. O contrato I1/I8 não muda.

## Não verificado aqui

ACL real no Windows além do teste de `icacls` (o job de Windows é consultivo) e um chaveiro de sistema real: o CI não instala `keyring`, e o teste injeta um backend falso. Isso entra no que o sandbox não faz (R3, #284). O modo POSIX e a migração rodam no CI de Linux.

## Consequências

Quem já tem segredos no cofre em arquivo os recupera na próxima abertura. Sem `keyring`, a proteção é "outro usuário desta máquina não lê".
