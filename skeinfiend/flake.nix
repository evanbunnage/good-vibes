{
  description = "SkeinFiend development: Node 24 and Postgres 18, as deployed";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

  outputs = { nixpkgs, ... }:
    let
      systems = [ "aarch64-darwin" "x86_64-darwin" "aarch64-linux" "x86_64-linux" ];
      forEachSystem = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      devShells = forEachSystem (pkgs: {
        default = pkgs.mkShell {
          packages = [ pkgs.nodejs_24 pkgs.postgresql_18 ];
          # The local Postgres keeps its data in the project; `npm run dev` starts it.
          shellHook = ''
            export PGDATA="$PWD/.pgdata"
          '';
        };
      });
    };
}
