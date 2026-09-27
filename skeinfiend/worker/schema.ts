/**
 * The app's own tables, beside Better Auth's ("user", "session", …). Each
 * row belongs to a signed-in person. A chart is stored whole, as the app
 * sends it, with its version (one more on each save) and the summary its
 * list shows; a colorwork motif is stored whole too.
 */
export const APP_SCHEMA = `
create table if not exists charts (
  owner      text   not null references "user"(id) on delete cascade,
  id         text   not null,
  version    int    not null,
  updated_at bigint not null,
  summary    jsonb  not null,
  doc        jsonb  not null,
  primary key (owner, id)
);

create table if not exists colorwork_motifs (
  owner      text   not null references "user"(id) on delete cascade,
  id         text   not null,
  edited_at  bigint not null,
  doc        jsonb  not null,
  primary key (owner, id)
);
`
