# ADR 0068 — Cofre em arquivo: permissão do usuário e chave por instalação

Status: aceita. Fecha o achado de SEC do PR #446 que já existia em `main` (issue #452). Não muda o diretório de dados (#409 / #446).

## Contexto

`OH_SECRETS=file` gravava o cofre com o modo padrão do processo (na prática 0644) e derivava a chave Fernet só do caminho absoluto. Quem lê o arquivo e conhece o caminho lê o segredo. No Windows a pasta herdava a ACL do pai.

## Decisão

- A pasta do cofre nasce `0700` e cada arquivo `0600`. No Windows a ACL é a de `restrict_to_current_user`. No POSIX a pasta não passa por essa função: hoje ela aplica `0600`, o que tira o bit de travessia de um diretório. A restrição acontece antes de qualquer byte de segredo: o arquivo é criado vazio já em `0600`, a ACL ou o modo é aplicado, e só então o conteúdo é escrito. Se a restrição falha, o arquivo vazio é apagado e nada é gravado.
- A chave deixa de ser o caminho. Cada instalação tem um segredo aleatório. Se o pacote opcional `keyring` tem um backend utilizável, o segredo fica no chaveiro (serviço `oharness.file-store`). Sem chaveiro, fica no arquivo `.install-key`, só do usuário, dentro da pasta do cofre.
- **Limitação, sem chaveiro:** qualquer processo do mesmo usuário lê a chave e o ciphertext. O modo `0600` (e a ACL) barra outros usuários, não outros processos deste usuário. Não substitui `OH_SECRETS=keychain`, que guarda as próprias credenciais no chaveiro.
- Arquivos antigos, cifrados com a derivação do caminho (`openharness.file-secrets.v1`), são relidos com essa chave e regravados com a chave nova na primeira abertura, no mesmo lugar. Um arquivo que nenhuma das duas chaves abre permanece no disco. A pasta pré-rebrand continua sendo aberta onde está, porque a chave antiga depende do caminho até essa migração.
- A via de assinatura (`credential.kind=cli`) não lê o cofre. O contrato I1/I8 não muda.

## Não verificado aqui

ACL real no Windows além do teste de `icacls` (o job de Windows é consultivo) e um chaveiro de sistema real: o CI não instala `keyring`, e o teste injeta um backend falso. Isso entra no que o sandbox não faz (R3, #284). O modo POSIX e a migração rodam no CI de Linux.

## Consequências

Quem já tem segredos no cofre em arquivo os recupera na próxima abertura. Sem `keyring`, a proteção é "outro usuário desta máquina não lê".
