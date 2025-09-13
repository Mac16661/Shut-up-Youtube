## Setup Instructions

### 1. Create and Activate Virtual Environment

#### Windows
```bash
# Create virtual environment
python -m venv .venv  

# Activate (CMD)
.venv\Scripts\activate.bat  

# Activate (PowerShell)
.venv\Scripts\Activate.ps
```

#### Linux
```bash
# Create virtual environment
python3 -m venv .venv  

# Activate
source .venv/bin/activate  
```

#### Install dependencies 
```bash
pip install -r requirements.txt
```