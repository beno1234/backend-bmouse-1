const express = require("express");
const app = express();
const router = express.Router();
const mysql = require("mysql");
const cors = require("cors");
const multer = require("multer");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const path = require("path");
const AWS = require("aws-sdk");
const multerS3 = require("multer-s3");
const nodemailer = require("nodemailer");
const smtpTransport = require("nodemailer-smtp-transport");
const fs = require("fs");
const bodyParser = require("body-parser");
const swaggerUi = require("swagger-ui-express");

const swaggerDocument = require("./swagger.json");

const crypto = require("crypto");

const axios = require("axios");

const { S3 } = require("@aws-sdk/client-s3");
const port = process.env.PORT || 5000;
require("dotenv").config();

const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_DATABASE,
});

app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ limit: "50mb", extended: true }));

const s3 = new S3({
  region: "us-east-1",
  credentials: {
    accessKeyId: "AKIATSR3CWEZ2URKJDCU",
    secretAccessKey: "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",
  },
});

const storage = multerS3({
  s3: s3,
  bucket: "beno-teste",
  //acl: "public-read",
  key: function (req, file, cb) {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});

const upload = multer({ storage: storage });

app.use("/uploads", express.static("uploads"));
app.use(express.json());
app.use(cors());

app.post("/login", (req, res) => {
  const email = req.body.email;
  const password = req.body.password;

  db.query(
    "SELECT * FROM users WHERE email = ?",
    [email],
    async (err, result) => {
      if (err) {
        res.status(500).send({ msg: "Erro interno do servidor", err });
        return;
      }
      if (result.length === 0) {
        res.status(401).send({ msg: "Usuário não registrado!" });
        return;
      }

      const storedPassword = result[0].password;
      const isHashed = storedPassword.startsWith("$2b$");
      let validPassword = false;

      if (isHashed) {
        validPassword = await bcrypt.compare(password, storedPassword);
      } else {
        validPassword = password === storedPassword;
      }

      if (!validPassword) {
        res.status(401).send({ msg: "Senha incorreta" });
        return;
      }

      // Gerando o token JWT
      const token = jwt.sign({ email: email }, "secretkey", {
        expiresIn: "1h",
      });
      res.json({ token });
    }
  );
});

app.get("/list-users", async (req, res) => {
  try {
    db.query("SELECT * FROM users", (err, results, fields) => {
      if (err) {
        return res.status(500).json({ message: err });
      }
      console.log(results);
      if (results.length > 0) {
        return res.status(200).json(results);
      } else {
        return res.status(401).json({ message: err });
      }
    });
  } catch (error) {
    console.log(error);
  }
});

app.post("/blog", upload.single("photo"), async (req, res) => {
  const { news, friendly_url, news_title } = req.body;
  if (!req.file) {
    throw Error("arquivo nao encontrado");
  }
  const photo = req.file.location; // URL of the uploaded photo on S3

  // Get current date
  const post_day = new Date().toISOString().slice(0, 10);
  console.log({ news, friendly_url, news_title, photo, post_day });

  try {
    const result = await db.query(
      "INSERT INTO blog (photo, news, friendly_url, news_title, post_day, uuid) VALUES (?, ?, ?, ?, ?, UUID())",
      [photo, news, friendly_url, news_title, post_day]
    );

    res.status(201).send({ msg: "Blog post added successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).send({ msg: "Error processing request" });
  }
});

/* app.get("/uploads/:photo", async (req, res) => {
  const photo = req.params.photo;
  try {
    const [rows] = await db.query(
      "SELECT photo_data FROM blog WHERE photo = ?",
      [photo]
    );
    if (rows.length === 0) {
      res.status(404).send({ msg: "Image not found" });
      return;
    }
    const photo_data = rows[0].photo_data;
    res.contentType("image/jpeg");
    res.send(photo_data);
  } catch (err) {
    console.error(err);
    res.status(500).send({ msg: "Error processing request" });
  }
}); */

app.get("/blog", async (req, res) => {
  try {
    db.query("SELECT * FROM blog", (err, results) => {
      if (err) {
        return;
      }

      // Modify the response to include the S3 URL to the uploaded image
      const blogPosts = results.map((post) => ({
        uuid: post.uuid,
        photo: post.photo, // Add the S3 URL to the photo
        news: post.news,
        friendly_url: post.friendly_url,
        news_title: post.news_title,
        post_day: new Date(post.post_day).toLocaleDateString("pt-BR", {
          month: "long",
          day: "numeric",
          year: "numeric",
        }),
      }));

      res.status(200).send(blogPosts);
    });
  } catch (err) {
    console.error(err);
    res.status(500).send({ msg: "Error processing request" });
  }
});

app.get("/blog/:friendly_url", async (req, res) => {
  try {
    const friendly_url = req.params.friendly_url;
    db.query(
      "SELECT * FROM blog WHERE friendly_url=?",
      [friendly_url],
      (err, results) => {
        if (err) {
          console.error(err);
          res.status(500).send({ msg: "Error processing request" });
          return;
        }
        if (results.length === 0) {
          res.status(404).send({ msg: "Blog post not found" });
          return;
        }
        const blogPost = results[0];
        res.status(200).send(blogPost);
      }
    );
  } catch (err) {
    console.error(err);
    res.status(500).send({ msg: "Error processing request" });
  }
});

app.delete("/blog/:uuid", async (req, res) => {
  try {
    const uuid = req.params.uuid;
    db.query("DELETE FROM blog WHERE uuid=?", [uuid], (err, results) => {
      if (err) {
        console.error(err);
        res.status(500).send({ msg: "Error processing request" });
        return;
      }
      if (results.affectedRows === 0) {
        res.status(404).send({ msg: "Blog post not found" });
        return;
      }
      res.status(200).send({ msg: "Blog post deleted successfully" });
    });
  } catch (err) {
    console.error(err);
    res.status(500).send({ msg: "Error processing request" });
  }
});

/* app.get("/blog/:d", async (req, res) => {
  try {
    const friendly_url = req.params.friendly_url;
    db.query(
      "SELECT * FROM blog WHERE friendly_url=?",
      [friendly_url],
      (err, results) => {
        if (err) {
          console.error(err);
          res.status(500).send({ msg: "Error processing request" });
          return;
        }
        if (results.length === 0) {
          res.status(404).send({ msg: "Blog post not found" });
          return;
        }
        const blogPost = results[0];
        res.status(200).send(blogPost);
      }
    );
  } catch (err) {
    console.error(err);
    res.status(500).send({ msg: "Error processing request" });
  }
}); */

app.put("/blog/:friendly_url", upload.single("photo"), async (req, res) => {
  const { news, news_title } = req.body;
  const friendly_url = req.params.friendly_url;

  // Check if photo was uploaded
  let photo;
  if (req.file) {
    photo = req.file.location; // Use the S3 URL of the uploaded photo
  }

  // Generate the SQL query string
  let query = "UPDATE blog SET ";
  const queryParams = [];
  if (news) {
    query += "news = ?, ";
    queryParams.push(news);
  }
  if (friendly_url) {
    query += "friendly_url = ?, ";
    queryParams.push(friendly_url);
  }
  if (news_title) {
    query += "news_title = ?, ";
    queryParams.push(news_title);
  }
  if (photo) {
    query += "photo = ?, ";
    queryParams.push(photo);
  }

  query = query.slice(0, -2); // Remove the last comma and space
  query += " WHERE friendly_url = ?";
  queryParams.push(friendly_url);

  new Promise((resolve, reject) => {
    db.query(query, queryParams, (error, results) => {
      if (error) {
        reject(error);
      } else {
        resolve(results);
      }
    });
  })
    .then((results) => {
      res.status(200).send({ msg: "Blog post updated successfully" });
    })
    .catch((error) => {
      console.error(error);
      res.status(500).send({ msg: "Error processing request" });
    });
});

async function enviarEmailBackend(
  nome,
  telefone,
  email,
  modalidade,
  especialidade,
  mensagem,
  curriculoFile,
  curriculoName
) {
  try {
    // Configurações do servidor SMTP
    let transporter = nodemailer.createTransport(
      smtpTransport({
        host: "smtp.gmail.com",
        port: 465,
        secure: true,
        auth: {
          user: "contas@bmouseproductions.com",
          pass: "knvwhsvlydkuriuc",
        },
      })
    );

    // Corpo do e-mail
    let info = await transporter.sendMail({
      from: "contas@bmouseproductions.com",
      to: ["contas@bmouseproductions.com", "tom@bmouseproductions.com"],
      subject: "Nova candidatura no formulário de Trabalhe Conosco",
      html: `<p>Nome: ${nome}</p>
             <p>Telefone: ${telefone}</p>
             <p>E-mail: ${email}</p>
             <p>Modalidade de trabalho: ${modalidade}</p>
             <p>Especialidade: ${especialidade}</p>
             <p>Mensagem: ${mensagem}</p>`,
      attachments: [
        {
          filename: curriculoName,
          content: curriculoFile.split(",")[1],
          encoding: "base64",
        },
      ],
    });

    console.log("E-mail enviado: %s", info.messageId);
  } catch (err) {
    console.error(err);
  }
}

app.post("/send-email", async (req, res) => {
  const {
    nome,
    telefone,
    email,
    modalidade,
    especialidade,
    mensagem,
    curriculoFile,
    curriculoName,
  } = req.body;

  try {
    await enviarEmailBackend(
      nome,
      telefone,
      email,
      modalidade,
      especialidade,
      mensagem,
      curriculoFile,
      curriculoName
    );
    res.status(200).json({ msg: "E-mail enviado com sucesso" });
  } catch (error) {
    console.error("Erro ao enviar e-mail:", error);
    res.status(500).json({ error: "Erro ao enviar e-mail" });
  }
});

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));

function hashSha256(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

const city = "São Paulo";
const state = "SP";
const zipcode = "01311-000";
const country = "Brasil";
const gender = "M";
const dateOfBirth = "1990-01-01";

const hashedCity = hashSha256(city);
const hashedState = hashSha256(state);
const hashedZipcode = hashSha256(zipcode);
const hashedCountry = hashSha256(country);
const hashedGender = hashSha256(gender);
const hashedDateOfBirth = hashSha256(dateOfBirth);

const user_data = {
  client_ip_address: "254.254.254.254",
  client_user_agent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.93 Safari/537.36",
  fbp: "fb.1.1558763799645.1098115397",
  fbc: "fb.1.1558571054389.Abk-oru7J5g8eUeVlj.0",
  external_id: "123456",
  ct: hashedCity,
  st: hashedState,
  zp: hashedZipcode,
  country: hashedCountry,
  ge: hashedGender,
  db: hashedDateOfBirth,
};

console.log(user_data);

app.post("/:event_id", (req, res) => {
  const event_id = req.params.event_id;
  const { event_name, user_data, event_source_url, custom_data } = req.body;

  const event_time = Math.floor(Date.now() / 1000);

  // Crie o objeto de evento baseado no nome do evento
  let event;
  if (event_name === "ViewContent") {
    event = {
      event_name,
      event_time,
      event_source_url,
      custom_data,
      user_data,
    };
  } else if (event_name === "Contact") {
    event = {
      event_name,
      event_time,
      user_data,
    };
  } else {
    return res.status(400).json({ error: "Invalid event_name" });
  }

  axios({
    method: "post",
    url: `https://graph.facebook.com/v13.0/298623158823542/events`,
    data: {
      data: [event],
      test_event_code: event_id,
    },
    params: {
      access_token:
        "EAAxDuNVFlrgBADH9rJ2d1LEi4rGQybsR9JwdlFoxMYXuCtTezZBCsRVwG0F6PwfRj1hY4NILxEgqGh6UuZAFF8A17WFIPeJZC6X1J2aGW1ZBwf2Ty5ckKu9nVN0M68MZBn2273OsnyEaM5DcbASZCf04QL309WuVGY82BUZAZBasoNZAIB89DCX2ZAS7yvHWckoPQZD",
    },
  })
    .then((response) => {
      res.status(200).json(response.data);
    })
    .catch((error) => {
      res.status(500).json(error.response.data);
    });
});

app.listen(port, () => {
  console.info(`aplicacao rodando ${port}`);
});
