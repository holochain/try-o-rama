{
  inputs = {
    holonix.url = "github:holochain/holonix/main";

    nixpkgs.follows = "holonix/nixpkgs";

    # lib to build a nix package from a rust crate
    crane = {
      url = "github:ipetkov/crane";
      inputs.nixpkgs.follows = "holonix/nixpkgs";
    };

    # Rust toolchain
    rust-overlay = {
      url = "github:oxalica/rust-overlay";
      inputs.nixpkgs.follows = "holonix/nixpkgs";
    };
  };

  outputs = inputs@{ nixpkgs, holonix, crane, rust-overlay, ... }:
    holonix.inputs.flake-parts.lib.mkFlake { inherit inputs; } {
      # provide a dev shell for all systems that the holonix flake supports
      systems = builtins.attrNames holonix.devShells;

      perSystem = { inputs', config, system, pkgs, lib, ... }:
        {
          formatter = pkgs.nixpkgs-fmt;

          devShells.default = pkgs.mkShell {
            inputsFrom = [ inputs'.holonix.devShells ];
            packages = (with inputs'.holonix.packages; [
                # add packages from Holonix
                holochain
                lair-keystore
                rust
            ]) ++ (with pkgs; [
              # add further packages from nixpkgs
              nodejs
            ]);
          };

          packages.trycp-server =
            let
              pkgs = import nixpkgs {
                inherit system;
                overlays = [ (import rust-overlay) ];
              };

              rustToolchain = pkgs.rust-bin.stable."1.78.0".minimal;

              craneLib = (crane.mkLib pkgs).overrideToolchain rustToolchain;

              crateInfo = craneLib.crateNameFromCargoToml { cargoToml = ./crates/trycp_server/Cargo.toml; };
            in
            craneLib.buildPackage {
              pname = "trycp-server";
              version = crateInfo.version;
              src = craneLib.cleanCargoSource (craneLib.path ./.);
              doCheck = false;

              buildInputs = [ ]
                ++ (lib.optionals pkgs.stdenv.isDarwin
                (with pkgs.darwin.apple_sdk.frameworks; [
                  CoreFoundation
                  Security
                ]));
            };
        };
    };
}
