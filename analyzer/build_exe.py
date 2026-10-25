"""
Script utilitário para empacotar o analyzer.py em um executável autônomo (analyzer.exe)
usando PyInstaller. Quando compilado, qualquer usuário do app Kring VLR pode
realizar análises de VODs mesmo sem ter o Python instalado na máquina.
"""
import os
import sys
import subprocess

def build():
    print("Iniciando compilação do Kring VLR Scrim Analyzer...")
    analyzer_dir = os.path.dirname(os.path.abspath(__file__))
    script_path = os.path.join(analyzer_dir, "analyzer.py")
    
    cmd = [
        sys.executable, "-m", "PyInstaller",
        "--name", "analyzer",
        "--onefile",
        "--clean",
        "--collect-all", "rapidocr_onnxruntime",
        "--collect-all", "onnxruntime",
        "--distpath", os.path.join(analyzer_dir, "dist"),
        "--workpath", os.path.join(analyzer_dir, "build"),
        "--specpath", analyzer_dir,
        script_path
    ]
    
    print("Executando:", " ".join(cmd))
    res = subprocess.run(cmd)
    if res.returncode == 0:
        print("\nSucesso! Executável gerado em analyzer/dist/analyzer.exe")
    else:
        print(f"\nErro na compilação: código {res.returncode}")

if __name__ == "__main__":
    build()
