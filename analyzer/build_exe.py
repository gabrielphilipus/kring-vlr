"""
Script utilitário para empacotar o analyzer.py em um executável autônomo (analyzer.exe)
usando PyInstaller. Quando compilado, qualquer usuário do app Kring VLR pode
realizar análises de VODs mesmo sem ter o Python instalado na máquina.
"""
import os
import subprocess
import sys


def build(if_missing: bool = False):
    analyzer_dir = os.path.dirname(os.path.abspath(__file__))
    target_exe = os.path.join(analyzer_dir, "analyzer.exe")

    if if_missing and os.path.exists(target_exe) and os.path.getsize(target_exe) > 1024 * 1024:
        print(f"Executável autônomo já presente em: {target_exe}")
        print("Pulando compilação do PyInstaller. (Passe --force para recompilar)")
        return

    print("Iniciando compilação do Kring VLR Scrim Analyzer...")
    script_path = os.path.join(analyzer_dir, "analyzer.py")

    templates_dir = os.path.join(analyzer_dir, "templates")
    cmd = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--name",
        "analyzer",
        "--onefile",
        "--clean",
        "--collect-all",
        "rapidocr_onnxruntime",
        "--collect-all",
        "onnxruntime",
        "--hidden-import",
        "interpret",
        "--hidden-import",
        "analyzer.interpret",
        "--add-data",
        f"{templates_dir};templates",
        "--distpath",
        os.path.join(analyzer_dir, "dist"),
        "--workpath",
        os.path.join(analyzer_dir, "build"),
        "--specpath",
        analyzer_dir,
        script_path,
    ]

    print("Executando:", " ".join(cmd))
    res = subprocess.run(cmd)
    if res.returncode == 0:
        import shutil

        dist_exe = os.path.join(analyzer_dir, "dist", "analyzer.exe")
        target_exe = os.path.join(analyzer_dir, "analyzer.exe")
        shutil.copy2(dist_exe, target_exe)
        print(f"\nSucesso! Executável gerado e disponível em:\n - {dist_exe}\n - {target_exe}")
    else:
        print(f"\nErro na compilação: código {res.returncode}")


if __name__ == "__main__":
    if_missing = "--if-missing" in sys.argv
    build(if_missing=if_missing)
