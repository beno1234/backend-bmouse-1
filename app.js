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
const fs = require("fs");

const { S3 } = require("@aws-sdk/client-s3");
const port = process.env.PORT || 4000;
require("dotenv").config();

const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_DATABASE,
});

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
    photo = req.file.filename;
  }

  // Update fields that are not null
  const fieldsToUpdate = {};
  if (news) fieldsToUpdate.news = news;
  if (friendly_url) fieldsToUpdate.friendly_url = friendly_url;
  if (news_title) fieldsToUpdate.news_title = news_title;
  if (photo) fieldsToUpdate.photo = photo;

  try {
    const query = "UPDATE blog SET ? WHERE friendly_url = ?";
    db.query(query, [fieldsToUpdate, friendly_url], (error, results) => {
      if (error) {
        console.error(error);
        res.status(500).send({ msg: "Error processing request" });
        return;
      }
      res.status(200).send({ msg: "Blog post updated successfully" });
    });
  } catch (error) {
    console.error(error);
    res.status(500).send({ msg: "Error processing request" });
  }
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
    let transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: {
        user: "contas@bmouseproductions.com",
        pass: "knvwhsvlydkuriuc",
      },
    });

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

app.listen(port, () => {
  console.info(`aplicacao rodando ${port}`);
});
