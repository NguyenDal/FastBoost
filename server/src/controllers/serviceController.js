const prisma = require("../prisma");

const createService = async (req, res) => {
  try {
    const { title, description } = req.body;

    if (!title) {
      return res.status(400).json({
        ok: false,
        message: "Title is required",
      });
    }

    const service = await prisma.service.create({
      data: {
        title,
        description,
      },
    });

    return res.status(201).json({
      ok: true,
      message: "Service created successfully",
      service,
    });
  } catch (error) {
    console.error("Create service error:", error);
    return res.status(500).json({
      ok: false,
      message: "Server error",
    });
  }
};

const getAllServices = async (req, res) => {
  try {
    const services = await prisma.service.findMany({
      orderBy: {
        createdAt: "desc",
      },
    });

    return res.status(200).json({
      ok: true,
      services,
    });
  } catch (error) {
    console.error("Get services error:", error);
    return res.status(500).json({
      ok: false,
      message: "Server error",
    });
  }
};

const getServiceById = async (req, res) => {
  try {
    const { id } = req.params;

    const service = await prisma.service.findUnique({
      where: { id },
    });

    if (!service) {
      return res.status(404).json({
        ok: false,
        message: "Service not found",
      });
    }

    return res.status(200).json({
      ok: true,
      service,
    });
  } catch (error) {
    console.error("Get service by id error:", error);
    return res.status(500).json({
      ok: false,
      message: "Server error",
    });
  }
};

module.exports = {
  createService,
  getAllServices,
  getServiceById,
};